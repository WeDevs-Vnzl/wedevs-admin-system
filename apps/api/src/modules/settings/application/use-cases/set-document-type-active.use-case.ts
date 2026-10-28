import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  DocumentTypeCatalog,
  recordSettingsChange,
  type DocumentTypeDetailView,
} from '../document-type-catalog';
import type { DocumentTypeRepository } from '../ports/document-type.repository.port';

export interface SetDocumentTypeActiveInput {
  readonly id: string;
  readonly active: boolean;
}

/**
 * `POST /document-types/{id}/active` (`settings` update). Activates or deactivates a type: the way to
 * retire one that documents use (HU-21 CA2). Writes and logs only a real change.
 */
export class SetDocumentTypeActive {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly types: DocumentTypeRepository,
    private readonly catalog: DocumentTypeCatalog,
    private readonly activity: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: SetDocumentTypeActiveInput,
  ): Promise<DocumentTypeDetailView> {
    assertCan(this.authorization, actor, 'update', 'settings');

    return this.uow.run(async () => {
      const row = await this.catalog.requireType(input.id);
      if (row.active === input.active) return this.catalog.typeDetail(row);
      const next = { ...row, active: input.active };
      await this.types.update(next);
      await recordSettingsChange(
        this.activity,
        actor,
        { id: next.id, label: next.name },
        { active: [row.active, next.active] },
      );
      return this.catalog.typeDetail(next);
    });
  }
}
