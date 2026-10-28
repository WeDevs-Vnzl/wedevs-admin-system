import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import { isFullOrder, type DocumentCategory } from '../../domain/document-category';
import {
  DOCUMENT_TYPE_MESSAGES,
  DocumentTypeCatalog,
  recordSettingsChange,
  type DocumentCategoryView,
} from '../document-type-catalog';
import type { DocumentCategoryRepository } from '../ports/document-category.repository.port';

export interface ReorderDocumentCategoriesInput {
  /** Every category id, in the new order. */
  readonly orderedIds: readonly string[];
}

/** Label and id of the one activity entry a reorder logs (the mock's shape: the whole list, not a row). */
const REORDER_ENTITY = 'document-categories';

/**
 * `POST /document-categories/reorder` (`settings` update). Takes exactly the full id set, all or nothing
 * (`VALIDATION` on `orderedIds` otherwise), renumbers `order` from 0 and logs the name order when it moved.
 */
export class ReorderDocumentCategories {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly categories: DocumentCategoryRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: ReorderDocumentCategoriesInput,
  ): Promise<DocumentCategoryView[]> {
    assertCan(this.authorization, actor, 'update', 'settings');

    return this.uow.run(async () => {
      const current = await this.catalog.listCategories();
      if (
        !isFullOrder(
          current.map((c) => c.id),
          input.orderedIds,
        )
      ) {
        throw new ValidationFailedError({
          fieldErrors: { orderedIds: [DOCUMENT_TYPE_MESSAGES.reorderMismatch] },
        });
      }
      const byId = new Map(current.map((c) => [c.id, c] as const));
      const ordered = input.orderedIds
        .map((id) => byId.get(id))
        .filter((row): row is DocumentCategory => row !== undefined);

      const before = current.map((c) => c.name);
      for (const [index, row] of ordered.entries()) {
        if (row.order !== index) await this.categories.update({ ...row, order: index });
      }
      const after = ordered.map((c) => c.name);

      if (before.join('\n') !== after.join('\n')) {
        await recordSettingsChange(
          this.activity,
          actor,
          { id: REORDER_ENTITY, label: REORDER_ENTITY },
          { documentCategoryOrder: [before.join(', '), after.join(', ')] },
        );
      }
      return this.catalog.categoryViews();
    });
  }
}
