import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { sortContacts, type ContactRecord, type ContactView } from '../../domain/contact';
import type { ClientDetailView, ClientRecord } from '../../domain/client';
import { tagNamesSnapshot, type TagChipView } from '../../domain/client-fields';
import type { ContactRepository } from '../ports/contact.repository.port';

/** The tag target of a client or a contact (structurally the settings context's `TagTarget`). */
export const clientTarget = (id: string) => ({ entityType: 'CLIENT' as const, entityId: id });
export const contactTarget = (id: string) => ({ entityType: 'CONTACT' as const, entityId: id });

type Target = ReturnType<typeof clientTarget> | ReturnType<typeof contactTarget>;

/** The tag chips of each target, in the order of `targets` (`chipsFor` builds its map in that order). */
export async function chipsByTarget(
  assignments: TagAssignments,
  targets: readonly Target[],
): Promise<TagChipView[][]> {
  if (targets.length === 0) return [];
  const byTarget = await assignments.chipsFor(targets);
  return [...byTarget.values()];
}

/** The readable tag snapshot of one target, for the activity diff (C1). */
export async function tagNamesOf(assignments: TagAssignments, target: Target): Promise<string> {
  const [chips] = await chipsByTarget(assignments, [target]);
  return tagNamesSnapshot((chips ?? []).map((chip) => chip.name));
}

export function toContactViews(
  contacts: readonly ContactRecord[],
  chips: readonly (readonly TagChipView[])[],
): ContactView[] {
  return contacts.map((contact, index) => ({ contact, tags: [...(chips[index] ?? [])] }));
}

/** The client detail: tags, and its live contacts (primary first) with their tags. No financials (Q-BE2-4). */
export async function readClientDetail(
  contacts: ContactRepository,
  assignments: TagAssignments,
  client: ClientRecord,
): Promise<ClientDetailView> {
  const live = sortContacts(await contacts.findLiveByClient(client.id));
  const chips = await chipsByTarget(assignments, [
    clientTarget(client.id),
    ...live.map((contact) => contactTarget(contact.id)),
  ]);
  return {
    client,
    tags: [...(chips[0] ?? [])],
    contacts: toContactViews(live, chips.slice(1)),
  };
}
