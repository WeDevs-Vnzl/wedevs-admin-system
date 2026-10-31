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
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import {
  contactSearchEntry,
  normalizeContact,
  type ContactInput,
  type ContactRecord,
  type ContactView,
} from '../../domain/contact';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { contactTarget } from './client-support';
import { demoteOtherPrimaries, readContactView } from './contact-support';

/**
 * `POST /clients/{id}/contacts` (HU-04). Order: `can(create, contact)` → name + e-mail or phone (CA1) →
 * one unit of work: the client must be live (`NOT_FOUND`); a new primary unsets the previous one first,
 * logging the demotion (CA2); insert, tags, `CREATE` activity with the `clientId`, search entry (CA3).
 */
export class CreateContact {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: ContactInput & { readonly clientId: string },
  ): Promise<ContactView> {
    assertCan(this.authorization, actor, 'create', 'contact');
    const { values, tagIds } = normalizeContact(input);

    return this.uow.run(async () => {
      // Locked: an archive of the client in flight finishes first, and then this is NOT_FOUND.
      const client = await this.clients.findByIdForUpdate(input.clientId);
      if (!client || client.deletedAt) throw new NotFoundError();

      const now = this.clock.now();
      const record: ContactRecord = {
        ...values,
        id: this.ids.next(),
        clientId: client.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      if (record.isPrimary) {
        await demoteOtherPrimaries(this.contacts, this.activityLog, actor, client.id, null, now);
      }
      await this.contacts.insert(record);
      await this.assignments.replace(actor, contactTarget(record.id), tagIds);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'CREATE',
        entityType: 'CONTACT',
        entityId: record.id,
        entityLabel: record.fullName,
        clientId: client.id,
        metadata: { clientId: client.id },
      });
      await this.searchIndex.upsert(contactSearchEntry(record));
      return readContactView(this.assignments, record);
    });
  }
}
