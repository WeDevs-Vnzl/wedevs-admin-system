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
import { IntegrityLockedError, NotFoundError } from '../../../../shared/domain/domain-error';
import {
  CLIENT_ARCHIVE_NEEDS_CONFIRM_KEY,
  toClientRef,
  type ClientRecord,
} from '../../domain/client';
import type { ClientFinanceDependentsPort } from '../ports/client-finance-dependents.port';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';

export interface ArchiveClientsInput {
  readonly ids: readonly string[];
  readonly confirm: boolean;
}

export interface ClientArchiveResult {
  readonly id: string;
  readonly archivedAt: Date;
  readonly archivedContacts: number;
}

/**
 * `POST /clients/{id}/archive` (a bulk of one) and `POST /clients/archive` (C19, PRD §7.7). Order:
 * `can(delete, client)` → one unit of work for the whole selection, so it is all or nothing: every client
 * must be live (`NOT_FOUND`); without `confirm`, a live project in progress or an open invoice locks the
 * archive (`INTEGRITY_LOCK` `clients.errors.archiveNeedsConfirm` with the client as `entity`); then each
 * client and its live contacts are archived with the **same** `deletedAt`, one `DELETE` entry each
 * (contacts carry `cascade` and `wasPrimary`), and their search entries are archived.
 */
export class ArchiveClients {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly financeDependents: ClientFinanceDependentsPort,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: ArchiveClientsInput): Promise<ClientArchiveResult[]> {
    assertCan(this.authorization, actor, 'delete', 'client');

    return this.uow.run(async () => {
      const records: ClientRecord[] = [];
      for (const id of new Set(input.ids)) {
        const record = await this.clients.findById(id);
        if (!record || record.deletedAt) throw new NotFoundError();
        records.push(record);
      }
      if (!input.confirm) {
        for (const record of records) await this.assertArchivable(record);
      }

      const at = this.clock.now();
      const results: ClientArchiveResult[] = [];
      for (const record of records) {
        await this.clients.archive(record.id, at, actor.userId);
        const contacts = await this.contacts.archiveLiveOfClient(record.id, at);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'DELETE',
          entityType: 'CLIENT',
          entityId: record.id,
          entityLabel: record.tradeName,
          clientId: record.id,
          metadata: { archivedContacts: contacts.length },
        });
        await this.searchIndex.setArchived('CLIENT', record.id, true);
        for (const contact of contacts) {
          await this.activityLog.record({
            actor: actorOf(actor),
            action: 'DELETE',
            entityType: 'CONTACT',
            entityId: contact.id,
            entityLabel: contact.fullName,
            clientId: record.id,
            metadata: { clientId: record.id, cascade: true, wasPrimary: contact.isPrimary },
          });
          await this.searchIndex.setArchived('CONTACT', contact.id, true);
        }
        results.push({ id: record.id, archivedAt: at, archivedContacts: contacts.length });
      }
      return results;
    });
  }

  /** Active projects or open invoices need the user's confirmation (C19). */
  private async assertArchivable(record: ClientRecord): Promise<void> {
    const locked =
      (await this.clients.hasActiveProjects(record.id)) ||
      (await this.financeDependents.hasOpenInvoices(record.id));
    if (locked) {
      throw new IntegrityLockedError({
        message: CLIENT_ARCHIVE_NEEDS_CONFIRM_KEY,
        entity: toClientRef(record),
      });
    }
  }
}
