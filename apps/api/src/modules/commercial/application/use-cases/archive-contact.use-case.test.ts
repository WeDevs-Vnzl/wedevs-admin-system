import { describe, expect, it } from 'vitest';
import { createWorld, nth, rejection } from '../../../../../test/commercial/clients/world';

describe('ArchiveContact', () => {
  it('soft-deletes, releases the primary flag and logs DELETE with the clientId', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({}, 1);
    const contact = w.contacts.seed({ ...nth(contacts, 0), isPrimary: true });
    const result = await w.archiveContact.execute(w.owner, { id: contact.id });
    expect(result).toEqual({ id: contact.id, archivedAt: w.clock.now() });
    expect(w.contacts.get(contact.id)).toMatchObject({
      deletedAt: w.clock.now(),
      isPrimary: false,
    });
    expect(w.activity.entries).toEqual([
      expect.objectContaining({
        action: 'DELETE',
        entityType: 'CONTACT',
        entityId: contact.id,
        clientId: client.id,
        changes: { isPrimary: [true, false] },
        metadata: { clientId: client.id },
      }),
    ]);
  });

  it('archives the search entry and omits the primary change for a plain contact', async () => {
    const w = createWorld();
    const { contacts } = w.seedClient({}, 1);
    await w.uow.run(() =>
      w.search.upsert({
        entityType: 'CONTACT',
        entityId: nth(contacts, 0).id,
        code: null,
        title: 'x',
        subtitle: null,
        body: null,
        status: null,
        archived: false,
      }),
    );
    await w.archiveContact.execute(w.owner, { id: nth(contacts, 0).id });
    expect(w.search.get('CONTACT', nth(contacts, 0).id)?.archived).toBe(true);
    expect(w.activity.entries[0]).not.toHaveProperty('changes');
  });

  it('answers NOT_FOUND for an unknown or already archived contact', async () => {
    const w = createWorld();
    const { contacts } = w.seedClient({}, 1);
    await w.archiveContact.execute(w.owner, { id: nth(contacts, 0).id });
    for (const id of ['con_nope', nth(contacts, 0).id]) {
      expect((await rejection(w.archiveContact.execute(w.owner, { id }))).code).toBe('NOT_FOUND');
    }
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const w = createWorld();
    const { contacts } = w.seedClient({}, 1);
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.archiveContact.execute(user, { id: nth(contacts, 0).id }))).code,
      ).toBe('FORBIDDEN');
    }
  });
});
