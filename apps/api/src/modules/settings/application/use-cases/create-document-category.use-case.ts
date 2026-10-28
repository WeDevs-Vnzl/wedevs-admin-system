import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
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

/**
 * `POST /document-categories` (`settings` create). Appends the category after the last one, refuses a
 * name taken case-insensitively and logs one `SETTINGS_CHANGE`, all in one unit of work (C12).
 */
export class CreateDocumentCategory {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly categories: DocumentCategoryRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly ids: IdGeneratorPort,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: DocumentCategoryInput): Promise<DocumentCategoryView> {
    assertCan(this.authorization, actor, 'create', 'settings');
    const fields = normalizeDocumentCategoryFields(input);

    return this.uow.run(async () => {
      await this.catalog.assertCategoryNameFree(fields.name);
      const existing = await this.catalog.listCategories();
      const order = existing.reduce((max, category) => Math.max(max, category.order + 1), 0);
      const row: DocumentCategory = { id: this.ids.next(), ...fields, order };
      await this.categories.insert(row);
      await recordSettingsChange(
        this.activity,
        actor,
        { id: row.id, label: row.name },
        { documentCategory: [null, row.name] },
      );
      return this.catalog.categoryView(row);
    });
  }
}
