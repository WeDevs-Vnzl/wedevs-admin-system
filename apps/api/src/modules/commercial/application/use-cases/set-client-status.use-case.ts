import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { SearchIndexPort } from '../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import { CLIENT_STATUS_VALUES, type ClientStatus } from '../../../../shared/domain/enums';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { clientSearchEntry, type ClientDetailView, type ClientRecord } from '../../domain/client';
import { FIELD_KEYS } from '../../domain/client-fields';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { readClientDetail } from './client-support';

/**
 * `POST /clients/{id}/status` (PRD §8.2, manual). `can(update, client)` → a live client (`NOT_FOUND`) →
 * the same status is a no-op without activity → otherwise `STATUS_CHANGE` with `{ status: [from, to] }`,
 * `activatedAt` set the first time the client becomes `ACTIVO`, and a reindex.
 */
export class SetClientStatus {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: { readonly id: string; readonly status: ClientStatus },
  ): Promise<ClientDetailView> {
    assertCan(this.authorization, actor, 'update', 'client');
    if (!(CLIENT_STATUS_VALUES as readonly string[]).includes(input.status)) {
      throw new ValidationFailedError({ fieldErrors: { status: [FIELD_KEYS.invalidOption] } });
    }

    return this.uow.run(async () => {
      const before = await this.clients.findById(input.id);
      if (!before || before.deletedAt) throw new NotFoundError();
      if (before.status === input.status) {
        return readClientDetail(this.contacts, this.assignments, before);
      }

      const now = this.clock.now();
      const after: ClientRecord = {
        ...before,
        status: input.status,
        activatedAt:
          input.status === 'ACTIVO' && before.activatedAt === null ? now : before.activatedAt,
        updatedAt: now,
      };
      await this.clients.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'STATUS_CHANGE',
        entityType: 'CLIENT',
        entityId: after.id,
        entityLabel: after.tradeName,
        clientId: after.id,
        changes: { status: [before.status, after.status] },
      });
      await this.searchIndex.upsert(clientSearchEntry(after));
      return readClientDetail(this.contacts, this.assignments, after);
    });
  }
}
