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
import { ConflictError, NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { toClientRef } from '../../domain/client';
import {
  TRASH_CLIENT_ARCHIVED_KEY,
  contactSearchEntry,
  type ContactView,
} from '../../domain/contact';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { readContactView } from './contact-support';

/**
 * Restore of a contact, reached only through the trash (the route is `POST /trash/restore`). `can(restore,
 * contact)` → an archived contact (`NOT_FOUND`) → its client must be live: still archived is a `CONFLICT`
 * `trash.errors.clientArchived` pointing at the client, which is restored first → `RESTORE` activity
 * with the `clientId` and a reindex.
 */
export class RestoreContact {
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

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<ContactView> {
    assertCan(this.authorization, actor, 'restore', 'contact');

    return this.uow.run(async () => {
      const archived = await this.contacts.findById(input.id);
      if (!archived?.deletedAt) throw new NotFoundError();
      // Locked, like CreateContact: the client cannot be archived between this check and the write.
      const client = await this.clients.findByIdForUpdate(archived.clientId);
      if (!client) throw new NotFoundError();
      if (client.deletedAt) {
        throw new ConflictError({
          message: TRASH_CLIENT_ARCHIVED_KEY,
          entity: toClientRef(client),
        });
      }

      const now = this.clock.now();
      await this.contacts.restoreMany([archived.id], now);
      const record = { ...archived, deletedAt: null, updatedAt: now };
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'RESTORE',
        entityType: 'CONTACT',
        entityId: record.id,
        entityLabel: record.fullName,
        clientId: record.clientId,
        metadata: { clientId: record.clientId },
      });
      await this.searchIndex.upsert(contactSearchEntry(record));
      return readContactView(this.assignments, record);
    });
  }
}
