import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../shared/domain/activity-diff';
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
import type { DocumentTypeSearchDependentsPort } from '../ports/document-type-search-dependents.port';

export interface UpdateDocumentTypeInput extends DocumentTypeInput {
  readonly id: string;
}

/** The fields a type edit compares for the activity entry (the id is never a field). */
const TYPE_FIELDS = [
  'categoryId',
  'name',
  'nameEn',
  'requiresSignature',
  'hasExpiration',
  'defaultFormat',
  'active',
] as const;

/**
 * `PATCH /document-types/{id}` (`settings` update). Every field is replaced, the category included; the
 * placement and name rules apply again. Runs `Serializable` (X18: the unit of work retries it); when `name`
 * changed it rewrites the type name in the documents' search entries (DT-166) before the activity entry. Logs
 * the field diff only when something changed.
 */
export class UpdateDocumentType {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly types: DocumentTypeRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly activity: ActivityLogPort,
    private readonly dependents: DocumentTypeSearchDependentsPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: UpdateDocumentTypeInput,
  ): Promise<DocumentTypeDetailView> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fields = normalizeDocumentTypeFields(input);

    return this.uow.run(
      async () => {
        const row = await this.catalog.requireType(input.id);
        await this.catalog.assertTypePlacement(fields.categoryId, fields.name, row.id);
        const next: DocumentType = { id: row.id, ...fields };
        const changes = diffFields({ ...row }, { ...next }, { fields: TYPE_FIELDS });
        if (changes !== null) await this.types.update(next);
        if (next.name !== row.name) await this.dependents.relabelType(next.id, next.name);
        await recordSettingsChange(
          this.activity,
          actor,
          { id: next.id, label: next.name },
          changes,
        );
        return this.catalog.typeDetail(next);
      },
      { isolation: 'Serializable' },
    );
  }
}
