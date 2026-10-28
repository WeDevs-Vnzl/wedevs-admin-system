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
import type { DocumentTypeRepository } from '../ports/document-type.repository.port';

/**
 * `DELETE /document-types/{id}` (`settings` delete). A real delete of an unused type. A type that any
 * document points at, archived ones included, is locked (`INTEGRITY_LOCK`, HU-21 CA2): deactivate it.
 */
export class DeleteDocumentType {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly types: DocumentTypeRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly id: string },
  ): Promise<{ readonly id: string }> {
    assertCan(this.authorization, actor, 'delete', 'settings');

    return this.uow.run(async () => {
      const row = await this.catalog.requireType(input.id);
      if ((await this.catalog.countDocuments(row.id)) > 0) {
        throw new IntegrityLockedError({ message: DOCUMENT_TYPE_MESSAGES.typeInUse });
      }
      await this.types.delete(row.id);
      await recordSettingsChange(
        this.activity,
        actor,
        { id: row.id, label: row.name },
        { documentType: [row.name, null] },
      );
      return { id: row.id };
    });
  }
}
