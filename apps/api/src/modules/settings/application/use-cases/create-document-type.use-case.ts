import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  normalizeDocumentTypeFields,
  type DocumentType,
  type DocumentTypeInput,
} from '../../domain/document-type';
import {
  DocumentTypeCatalog,
  recordSettingsChange,
  type DocumentTypeDetailView,
} from '../document-type-catalog';
import type { DocumentTypeRepository } from '../ports/document-type.repository.port';

/**
 * `POST /document-types` (`settings` create). The category must exist and the name must be free inside it
 * (case-insensitively). A new type is available at once (HU-21 CA1). Logs one `SETTINGS_CHANGE`.
 */
export class CreateDocumentType {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly types: DocumentTypeRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly ids: IdGeneratorPort,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: DocumentTypeInput): Promise<DocumentTypeDetailView> {
    assertCan(this.authorization, actor, 'create', 'settings');
    const fields = normalizeDocumentTypeFields(input);

    return this.uow.run(async () => {
      await this.catalog.assertTypePlacement(fields.categoryId, fields.name);
      const row: DocumentType = { id: this.ids.next(), ...fields };
      await this.types.insert(row);
      await recordSettingsChange(
        this.activity,
        actor,
        { id: row.id, label: row.name },
        { documentType: [null, row.name] },
      );
      return this.catalog.typeDetail(row);
    });
  }
}
