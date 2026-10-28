import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { IntegrityLockedError } from '../../../../shared/domain/domain-error';
import {
  DOCUMENT_TYPE_MESSAGES,
  DocumentTypeCatalog,
  recordSettingsChange,
} from '../document-type-catalog';
import type { DocumentCategoryRepository } from '../ports/document-category.repository.port';

/**
 * `DELETE /document-categories/{id}` (`settings` delete). A real delete (catalog rows are not soft-deleted,
 * data-rules.md §6), locked (`INTEGRITY_LOCK`) while the category still has types. The rest are renumbered.
 */
export class DeleteDocumentCategory {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly categories: DocumentCategoryRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly id: string },
  ): Promise<{ readonly id: string }> {
    assertCan(this.authorization, actor, 'delete', 'settings');

    return this.uow.run(async () => {
      const row = await this.catalog.requireCategory(input.id);
      if (await this.catalog.categoryHasTypes(row.id)) {
        throw new IntegrityLockedError({ message: DOCUMENT_TYPE_MESSAGES.categoryHasTypes });
      }
      await this.categories.delete(row.id);
      for (const [index, remaining] of (await this.catalog.listCategories()).entries()) {
        if (remaining.order !== index) {
          await this.categories.update({ ...remaining, order: index });
        }
      }
      await recordSettingsChange(
        this.activity,
        actor,
        { id: row.id, label: row.name },
        { documentCategory: [row.name, null] },
      );
      return { id: row.id };
    });
  }
}
