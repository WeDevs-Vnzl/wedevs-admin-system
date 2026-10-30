import { describe, expect, it } from 'vitest';
import { createWorld, nth, rejection } from '../../../../../test/commercial/clients/world';

describe('RestoreContact', () => {
  it('restores an archived contact of a live client, logging RESTORE and reindexing', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({}, 1);
    await w.archiveContact.execute(w.owner, { id: nth(contacts, 0).id });
    w.clock.advance(60_000);

    const view = await w.restoreContact.execute(w.owner, { id: nth(contacts, 0).id });
    expect(view.contact).toMatchObject({ deletedAt: null, updatedAt: w.clock.now() });
    expect(w.contacts.get(nth(contacts, 0).id)?.deletedAt).toBeNull();
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'RESTORE',
      entityType: 'CONTACT',
      clientId: client.id,
      metadata: { clientId: client.id },
    });
    expect(w.search.get('CONTACT', nth(contacts, 0).id)).toMatchObject({ archived: false });
  });

  it('answers CONFLICT trash.errors.clientArchived pointing at the client when the client is still archived', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient(
      { deletedAt: new Date(), tradeName: 'Kairos Studio' },
      1,
    );
    w.contacts.seed({ ...nth(contacts, 0), deletedAt: new Date() });
    const error = await rejection(w.restoreContact.execute(w.owner, { id: nth(contacts, 0).id }));
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'trash.errors.clientArchived',
      entity: { type: 'CLIENT', id: client.id, label: 'Kairos Studio' },
    });
    expect(w.contacts.get(nth(contacts, 0).id)?.deletedAt).not.toBeNull();
  });

  it('answers NOT_FOUND for a contact that is not archived and for an unknown one', async () => {
    const w = createWorld();
    const { contacts } = w.seedClient({}, 1);
    for (const id of [nth(contacts, 0).id, 'con_nope']) {
      expect((await rejection(w.restoreContact.execute(w.owner, { id }))).code).toBe('NOT_FOUND');
    }
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const w = createWorld();
    const { contacts } = w.seedClient({}, 1);
    await w.archiveContact.execute(w.owner, { id: nth(contacts, 0).id });
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.restoreContact.execute(user, { id: nth(contacts, 0).id }))).code,
      ).toBe('FORBIDDEN');
    }
  });
});
