import { describe, expect, it } from 'vitest';
import { createWorld, rejection } from '../../../../../test/commercial/clients/world';

function setup() {
  const w = createWorld();
  const { client, contacts } = w.seedClient({}, 2);
  const [first, second] = contacts as [(typeof contacts)[number], (typeof contacts)[number]];
  w.contacts.seed({ ...first, isPrimary: true });
  return { w, client, first, second };
}

describe('SetPrimaryContact', () => {
  it('unsets the previous primary so a client has at most one (CA2), logging both changes', async () => {
    const { w, client, first, second } = setup();
    w.clock.advance(60_000);
    const view = await w.setPrimaryContact.execute(w.owner, { id: second.id });
    expect(view.contact).toMatchObject({
      id: second.id,
      isPrimary: true,
      updatedAt: w.clock.now(),
    });
    expect(w.contacts.get(first.id)?.isPrimary).toBe(false);
    expect(w.contacts.rows.filter((c) => c.isPrimary)).toHaveLength(1);
    expect(w.activity.entries).toEqual([
      expect.objectContaining({
        entityId: first.id,
        clientId: client.id,
        changes: { isPrimary: [true, false] },
      }),
      expect.objectContaining({
        entityId: second.id,
        clientId: client.id,
        changes: { isPrimary: [false, true] },
      }),
    ]);
  });

  it('is a no-op for the current primary', async () => {
    const { w, first } = setup();
    await w.setPrimaryContact.execute(w.owner, { id: first.id });
    expect(w.activity.entries).toHaveLength(0);
  });

  it('answers NOT_FOUND for an unknown or archived contact', async () => {
    const { w, second } = setup();
    await w.archiveContact.execute(w.owner, { id: second.id });
    for (const id of ['con_nope', second.id]) {
      expect((await rejection(w.setPrimaryContact.execute(w.owner, { id }))).code).toBe(
        'NOT_FOUND',
      );
    }
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const { w, second } = setup();
    for (const user of [w.member, w.viewer]) {
      expect((await rejection(w.setPrimaryContact.execute(user, { id: second.id }))).code).toBe(
        'FORBIDDEN',
      );
    }
  });
});
