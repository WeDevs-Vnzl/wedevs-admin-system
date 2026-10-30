import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import type { ContactView } from '../../domain/contact';
import type { ContactRepository } from '../ports/contact.repository.port';
import { demoteOtherPrimaries, readContactView } from './contact-support';

/**
 * `POST /contacts/{id}/primary` (HU-04 CA2). `can(update, contact)` → a live contact (`NOT_FOUND`) → the
 * current primary is a no-op → otherwise the previous primary is unset first (logged) and this one is
 * set in the same unit of work, with `UPDATE` `{ isPrimary: [false, true] }`. A lost race on
 * `contact_one_primary` surfaces as `CONFLICT`.
 */
export class SetPrimaryContact {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: { readonly id: string }): Promise<ContactView> {
    assertCan(this.authorization, actor, 'update', 'contact');

    return this.uow.run(async () => {
      const before = await this.contacts.findById(input.id);
      if (!before || before.deletedAt) throw new NotFoundError();
      if (before.isPrimary) return readContactView(this.assignments, before);

      const now = this.clock.now();
      await demoteOtherPrimaries(
        this.contacts,
        this.activityLog,
        actor,
        before.clientId,
        before.id,
        now,
      );
      const after = { ...before, isPrimary: true, updatedAt: now };
      await this.contacts.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'UPDATE',
        entityType: 'CONTACT',
        entityId: after.id,
        entityLabel: after.fullName,
        clientId: after.clientId,
        changes: { isPrimary: [false, true] },
      });
      return readContactView(this.assignments, after);
    });
  }
}
