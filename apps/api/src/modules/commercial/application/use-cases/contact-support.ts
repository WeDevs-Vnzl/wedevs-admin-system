import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import type { ContactRecord, ContactView } from '../../domain/contact';
import type { ContactRepository } from '../ports/contact.repository.port';
import { chipsByTarget, contactTarget, toContactViews } from './client-support';

/** The view of one contact with its tag chips. */
export async function readContactView(
  assignments: TagAssignments,
  contact: ContactRecord,
): Promise<ContactView> {
  const chips = await chipsByTarget(assignments, [contactTarget(contact.id)]);
  return toContactViews([contact], chips)[0] as ContactView;
}

/**
 * Makes room for a new primary contact of the client (HU-04 CA2): every other live primary is unset and
 * each demotion is logged. Runs before the write that sets the flag, because `contact_one_primary` checks
 * every statement. Returns nothing; `keepId` is the contact that is about to become primary.
 */
export async function demoteOtherPrimaries(
  contacts: ContactRepository,
  activityLog: ActivityLogPort,
  actor: CurrentUser,
  clientId: string,
  keepId: string | null,
  now: Date,
): Promise<void> {
  for (const other of await contacts.findOtherPrimaries(clientId, keepId)) {
    await contacts.update({ ...other, isPrimary: false, updatedAt: now });
    await activityLog.record({
      actor: actorOf(actor),
      action: 'UPDATE',
      entityType: 'CONTACT',
      entityId: other.id,
      entityLabel: other.fullName,
      clientId,
      changes: { isPrimary: [true, false] },
    });
  }
}
