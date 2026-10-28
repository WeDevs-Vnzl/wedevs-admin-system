import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../shared/domain/activity-diff';
import {
  normalizeDocumentCategoryFields,
  type DocumentCategory,
  type DocumentCategoryInput,
} from '../../domain/document-category';
import {
  DocumentTypeCatalog,
  recordSettingsChange,
  type DocumentCategoryView,
} from '../document-type-catalog';
import type { DocumentCategoryRepository } from '../ports/document-category.repository.port';

export interface UpdateDocumentCategoryInput extends DocumentCategoryInput {
  readonly id: string;
}

/**
 * `PATCH /document-categories/{id}` (`settings` update). Edits name, English name and colour; the order
 * changes only through the reorder. Logs the field diff only when something changed.
 */
export class UpdateDocumentCategory {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly categories: DocumentCategoryRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: UpdateDocumentCategoryInput,
  ): Promise<DocumentCategoryView> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fields = normalizeDocumentCategoryFields(input);

    return this.uow.run(async () => {
      const row = await this.catalog.requireCategory(input.id);
      await this.catalog.assertCategoryNameFree(fields.name, row.id);
      const next: DocumentCategory = { ...row, ...fields };
      const changes = diffFields({ ...row }, { ...next }, { fields: ['name', 'nameEn', 'color'] });
      if (changes !== null) await this.categories.update(next);
      await recordSettingsChange(this.activity, actor, { id: next.id, label: next.name }, changes);
      return this.catalog.categoryView(next);
    });
  }
}
