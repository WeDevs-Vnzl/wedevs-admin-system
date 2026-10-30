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
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { ContactRepository } from '../ports/contact.repository.port';

export interface ContactArchiveResult {
  readonly id: string;
  readonly archivedAt: Date;
}

/**
 * `POST /contacts/{id}/archive` (HU-04, C19). `can(delete, contact)` → a live contact (`NOT_FOUND`) →
 * soft delete that also releases the primary flag, so the client can name another one; `DELETE` activity
 * with the `clientId` (and `isPrimary: [true, false]` when it was the primary); search entry archived.
 */
export class ArchiveContact {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly contacts: ContactRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<ContactArchiveResult> {
    assertCan(this.authorization, actor, 'delete', 'contact');

    return this.uow.run(async () => {
      const contact = await this.contacts.findById(input.id);
      if (!contact || contact.deletedAt) throw new NotFoundError();

      const at = this.clock.now();
      await this.contacts.archive(contact.id, at);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'DELETE',
        entityType: 'CONTACT',
        entityId: contact.id,
        entityLabel: contact.fullName,
        clientId: contact.clientId,
        ...(contact.isPrimary ? { changes: { isPrimary: [true, false] } } : {}),
        metadata: { clientId: contact.clientId },
      });
      await this.searchIndex.setArchived('CONTACT', contact.id, true);
      return { id: contact.id, archivedAt: at };
    });
  }
}
