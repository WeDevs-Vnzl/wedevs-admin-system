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
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import {
  contactChanges,
  contactSearchEntry,
  normalizeContact,
  type ContactInput,
  type ContactRecord,
  type ContactView,
} from '../../domain/contact';
import type { ContactRepository } from '../ports/contact.repository.port';
import { contactTarget, tagNamesOf } from './client-support';
import { demoteOtherPrimaries, readContactView } from './contact-support';

/**
 * `PATCH /contacts/{id}` (HU-04). The body is the full editable state; the client never changes. Order:
 * `can(update, contact)` → form rules → one unit of work: a live contact (`NOT_FOUND`), tags, diff. No write
 * and no activity when nothing changed. Becoming primary unsets the previous primary first (CA2).
 */
export class UpdateContact {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: ContactInput & { readonly id: string },
  ): Promise<ContactView> {
    assertCan(this.authorization, actor, 'update', 'contact');
    const { values, tagIds } = normalizeContact(input);

    return this.uow.run(async () => {
      const before = await this.contacts.findById(input.id);
      if (!before || before.deletedAt) throw new NotFoundError();

      const target = contactTarget(before.id);
      const namesBefore = await tagNamesOf(this.assignments, target);
      await this.assignments.replace(actor, target, tagIds);
      const namesAfter = await tagNamesOf(this.assignments, target);

      const changes = contactChanges(before, values, { before: namesBefore, after: namesAfter });
      if (changes === null) return readContactView(this.assignments, before);

      const now = this.clock.now();
      const after: ContactRecord = { ...before, ...values, updatedAt: now };
      if (after.isPrimary && !before.isPrimary) {
        await demoteOtherPrimaries(
          this.contacts,
          this.activityLog,
          actor,
          before.clientId,
          before.id,
          now,
        );
      }
      await this.contacts.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'UPDATE',
        entityType: 'CONTACT',
        entityId: after.id,
        entityLabel: after.fullName,
        clientId: after.clientId,
        changes,
      });
      await this.searchIndex.upsert(contactSearchEntry(after));
      return readContactView(this.assignments, after);
    });
  }
}
