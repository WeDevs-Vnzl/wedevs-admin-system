import { ConflictError } from '../../../../shared/domain/domain-error';
import { describe, expect, it } from 'vitest';
import { createWorld, nth, rejection } from '../../../../../test/commercial/clients/world';

const CASCADE_AT = new Date('2026-01-10T00:00:00.000Z');

function archivedClient(w: ReturnType<typeof createWorld>, over = {}) {
  const { client } = w.seedClient({ deletedAt: CASCADE_AT, ...over });
  const cascaded = [1, 2].map((n) =>
    w.contacts.seed({
      id: `${client.id}_c${n}`,
      clientId: client.id,
      fullName: `Cascade ${n}`,
      position: null,
      email: `c${n}@example.test`,
      phone: null,
      isPrimary: n === 1,
      createdAt: CASCADE_AT,
      updatedAt: CASCADE_AT,
      deletedAt: CASCADE_AT,
    }),
  );
  const alone = w.contacts.seed({
    ...nth(cascaded, 0),
    id: `${client.id}_alone`,
    isPrimary: false,
    deletedAt: new Date('2026-01-05T00:00:00.000Z'),
  });
  return { client, cascaded, alone };
}

describe('RestoreClient', () => {
  it('restores the client and exactly the contacts its cascade took, logging RESTORE', async () => {
    const w = createWorld();
    const { client, cascaded, alone } = archivedClient(w);
    w.clock.advance(60_000);
    const restored = await w.restoreClient.execute(w.owner, { id: client.id });

    expect(restored.client).toMatchObject({ deletedAt: null, updatedAt: w.clock.now() });
    expect(restored.contacts.map((c) => c.contact.id).sort()).toEqual(
      cascaded.map((c) => c.id).sort(),
    );
    expect(w.contacts.get(alone.id)?.deletedAt).not.toBeNull();
    const restores = w.activity.entries.filter((entry) => entry.action === 'RESTORE');
    expect(restores.filter((e) => e.entityType === 'CLIENT')).toEqual([
      expect.objectContaining({
        entityId: client.id,
        clientId: client.id,
        metadata: { restoredContacts: 2 },
      }),
    ]);
    expect(restores.filter((e) => e.entityType === 'CONTACT')).toHaveLength(2);
    expect(w.search.get('CLIENT', client.id)).toMatchObject({ archived: false });
    expect(w.search.get('CONTACT', nth(cascaded, 0).id)).toMatchObject({ archived: false });
    expect(w.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('answers CONFLICT with the holder when a live client now has the same tax id and country', async () => {
    const w = createWorld();
    const { client } = archivedClient(w, { taxId: 'J-30123456-7' });
    const holder = w.seedClient({ taxId: 'j301234567' }).client;
    const error = await rejection(w.restoreClient.execute(w.owner, { id: client.id }));
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'clients.errors.restoreTaxIdConflict',
      entity: { id: holder.id, type: 'CLIENT' },
    });
    expect(w.clients.get(client.id)?.deletedAt).not.toBeNull();
    expect(w.activity.entries).toHaveLength(0);
  });

  it('uses the trash key for the same conflict when reached through the trash', async () => {
    const w = createWorld();
    const { client } = archivedClient(w, { taxId: 'J-30123456-7' });
    w.seedClient({ taxId: 'J-30123456-7' });
    const error = await rejection(
      w.restoreClient.execute(w.owner, { id: client.id, via: 'trash' }),
    );
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'trash.errors.taxIdTaken' });
  });

  it('maps a lost race on the unique index to the same CONFLICT key', async () => {
    const w = createWorld();
    const { client } = archivedClient(w);
    w.clients.failNextRestoreWith = new ConflictError();
    const error = await rejection(w.restoreClient.execute(w.owner, { id: client.id }));
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'clients.errors.restoreTaxIdConflict',
    });
    expect(w.clients.get(client.id)?.deletedAt).not.toBeNull();
  });

  it('answers NOT_FOUND for a client that is not archived and for an unknown one', async () => {
    const w = createWorld();
    const live = w.seedClient().client;
    for (const id of [live.id, 'cli_nope']) {
      expect((await rejection(w.restoreClient.execute(w.owner, { id }))).code).toBe('NOT_FOUND');
    }
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const w = createWorld();
    const { client } = archivedClient(w);
    for (const user of [w.member, w.viewer]) {
      expect((await rejection(w.restoreClient.execute(user, { id: client.id }))).code).toBe(
        'FORBIDDEN',
      );
    }
  });
});
