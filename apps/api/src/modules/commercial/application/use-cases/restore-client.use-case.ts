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
import {
  CLIENT_RESTORE_TAX_ID_CONFLICT_KEY,
  TRASH_TAX_ID_TAKEN_KEY,
  clientSearchEntry,
  toClientRef,
  type ClientDetailView,
  type ClientRecord,
} from '../../domain/client';
import { contactSearchEntry } from '../../domain/contact';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { readClientDetail } from './client-support';

export interface RestoreClientInput {
  readonly id: string;
  /** Where the request came from decides the i18n key of a tax id conflict. */
  readonly via?: 'client' | 'trash';
}

/**
 * `POST /clients/{id}/restore` and the trash handler (C19). `can(restore, client)` → one `Serializable`
 * unit of work: the client must be archived (`NOT_FOUND`); a live client holding its tax id + country is a
 * `CONFLICT` linking the holder (`clients.errors.restoreTaxIdConflict`, or `trash.errors.taxIdTaken`
 * through the trash); then it comes back with exactly the contacts whose `deletedAt` equals its own (the
 * ones its cascade took), one `RESTORE` entry each, and a reindex.
 */
export class RestoreClient {
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

  async execute(actor: CurrentUser, input: RestoreClientInput): Promise<ClientDetailView> {
    assertCan(this.authorization, actor, 'restore', 'client');
    const conflictKey =
      input.via === 'trash' ? TRASH_TAX_ID_TAKEN_KEY : CLIENT_RESTORE_TAX_ID_CONFLICT_KEY;

    return this.uow.run(
      async () => {
        const archived = await this.clients.findById(input.id);
        if (!archived?.deletedAt) throw new NotFoundError();
        const holder = await this.clients.findTaxIdHolder(
          archived.taxId,
          archived.country,
          archived.id,
        );
        if (holder) throw new ConflictError({ message: conflictKey, entity: toClientRef(holder) });

        const cascadeAt = archived.deletedAt;
        const now = this.clock.now();
        try {
          await this.clients.restore(archived.id, now);
        } catch (error) {
          // A lost race on the unique index: the holder committed after the check above.
          throw error instanceof ConflictError && !error.entity
            ? new ConflictError({ message: conflictKey })
            : error;
        }
        const record: ClientRecord = { ...archived, deletedAt: null, updatedAt: now };
        const cascade = await this.contacts.findArchivedAt(archived.id, cascadeAt);
        await this.contacts.restoreMany(
          cascade.map((contact) => contact.id),
          now,
        );

        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'RESTORE',
          entityType: 'CLIENT',
          entityId: record.id,
          entityLabel: record.tradeName,
          clientId: record.id,
          metadata: { restoredContacts: cascade.length },
        });
        await this.searchIndex.upsert(clientSearchEntry(record));
        for (const contact of cascade) {
          await this.activityLog.record({
            actor: actorOf(actor),
            action: 'RESTORE',
            entityType: 'CONTACT',
            entityId: contact.id,
            entityLabel: contact.fullName,
            clientId: record.id,
            metadata: { clientId: record.id, cascade: true },
          });
          await this.searchIndex.upsert(
            contactSearchEntry({ ...contact, deletedAt: null, updatedAt: now }),
          );
        }
        return readClientDetail(this.contacts, this.assignments, record);
      },
      { isolation: 'Serializable' },
    );
  }
}
