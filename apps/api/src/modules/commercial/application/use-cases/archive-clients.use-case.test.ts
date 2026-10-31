import { describe, expect, it } from 'vitest';
import { createWorld, nth, rejection } from '../../../../../test/commercial/clients/world';

describe('ArchiveClients (C19)', () => {
  it('locks the clients in ascending id order whatever the order of the selection (M1)', async () => {
    const w = createWorld();
    const b = w.seedClient({ id: 'cli_b' }).client;
    const a = w.seedClient({ id: 'cli_a' }).client;
    const results = await w.archiveClients.execute(w.owner, {
      ids: [b.id, a.id, b.id],
      confirm: true,
    });
    expect(w.clients.lockedIds).toEqual(['cli_a', 'cli_b']);
    // The result keeps the order of the selection, duplicates dropped.
    expect(results.map((r) => r.id)).toEqual(['cli_b', 'cli_a']);
  });

  it('answers INTEGRITY_LOCK with a live project in progress and no confirm; nothing changes', async () => {
    const w = createWorld();
    const { client } = w.seedClient({ id: 'cli_kairos', tradeName: 'Kairos Studio' }, 2);
    w.clients.activeProjects.add(client.id);
    const error = await rejection(
      w.archiveClients.execute(w.owner, { ids: [client.id], confirm: false }),
    );
    expect(error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'clients.errors.archiveNeedsConfirm',
      entity: { type: 'CLIENT', id: client.id, label: 'Kairos Studio' },
    });
    expect(w.clients.get(client.id)?.deletedAt).toBeNull();
    expect(w.contacts.rows.every((c) => c.deletedAt === null)).toBe(true);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('locks on an open invoice and archives without confirm when only closed finance data exists', async () => {
    const w = createWorld();
    const open = w.seedClient().client;
    const free = w.seedClient().client;
    w.finance.withOpenInvoices.add(open.id);
    expect(
      (await rejection(w.archiveClients.execute(w.owner, { ids: [open.id], confirm: false }))).code,
    ).toBe('INTEGRITY_LOCK');
    await expect(
      w.archiveClients.execute(w.owner, { ids: [free.id], confirm: false }),
    ).resolves.toHaveLength(1);
  });

  it('with confirm archives the client and its live contacts with the same deletedAt and logs DELETE entries', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({ id: 'cli_1' }, 3);
    w.contacts.seed({ ...nth(contacts, 0), isPrimary: true });
    w.clients.activeProjects.add(client.id);
    const alone = w.contacts.seed({
      ...nth(contacts, 2),
      id: 'con_alone',
      deletedAt: new Date('2025-12-01T00:00:00.000Z'),
    });
    const [result] = await w.archiveClients.execute(w.owner, { ids: [client.id], confirm: true });
    expect(result).toEqual({ id: client.id, archivedAt: w.clock.now(), archivedContacts: 3 });

    expect(w.clients.get(client.id)?.deletedAt).toEqual(result?.archivedAt);
    expect(w.clients.deletedBy.get(client.id)).toBe(w.owner.userId);
    for (const contact of contacts) {
      expect(w.contacts.get(contact.id)?.deletedAt).toEqual(result?.archivedAt);
    }
    // A contact archived on its own earlier keeps its own date.
    expect(w.contacts.get(alone.id)?.deletedAt).toEqual(new Date('2025-12-01T00:00:00.000Z'));

    const deletes = w.activity.entries.filter((entry) => entry.action === 'DELETE');
    expect(deletes.filter((entry) => entry.entityType === 'CLIENT')).toEqual([
      expect.objectContaining({
        entityId: client.id,
        clientId: client.id,
        metadata: { archivedContacts: 3 },
      }),
    ]);
    const contactEntries = deletes.filter((entry) => entry.entityType === 'CONTACT');
    expect(contactEntries).toHaveLength(3);
    expect(contactEntries.every((entry) => entry.clientId === client.id)).toBe(true);
    expect(contactEntries.map((entry) => entry.metadata)).toEqual(
      expect.arrayContaining([
        { clientId: client.id, cascade: true, wasPrimary: true },
        { clientId: client.id, cascade: true, wasPrimary: false },
      ]),
    );
  });

  it('archives the search entries of the client and its contacts', async () => {
    const w = createWorld();
    const { client, contacts } = w.seedClient({}, 1);
    await w.uow.run(async () => {
      await w.search.upsert({
        entityType: 'CLIENT',
        entityId: client.id,
        code: client.code,
        title: 'x',
        subtitle: null,
        body: null,
        status: null,
        archived: false,
      });
      await w.search.upsert({
        entityType: 'CONTACT',
        entityId: nth(contacts, 0).id,
        code: null,
        title: 'y',
        subtitle: null,
        body: null,
        status: null,
        archived: false,
      });
    });
    await w.archiveClients.execute(w.owner, { ids: [client.id], confirm: false });
    expect(w.search.get('CLIENT', client.id)?.archived).toBe(true);
    expect(w.search.get('CONTACT', nth(contacts, 0).id)?.archived).toBe(true);
  });

  it('archives without confirmation when there are no active projects or open invoices', async () => {
    const w = createWorld();
    const { client } = w.seedClient({}, 2);
    const [result] = await w.archiveClients.execute(w.owner, { ids: [client.id], confirm: false });
    expect(result?.archivedContacts).toBe(2);
  });

  it('answers NOT_FOUND for an archived or unknown client', async () => {
    const w = createWorld();
    const archived = w.seedClient({ deletedAt: new Date() }).client;
    for (const id of ['cli_nope', archived.id]) {
      expect(
        (await rejection(w.archiveClients.execute(w.owner, { ids: [id], confirm: true }))).code,
      ).toBe('NOT_FOUND');
    }
  });

  describe('bulk', () => {
    it('archives every client of the selection, one result each, once per repeated id', async () => {
      const w = createWorld();
      const a = w.seedClient().client;
      const b = w.seedClient().client;
      const result = await w.archiveClients.execute(w.owner, {
        ids: [a.id, b.id, a.id],
        confirm: true,
      });
      expect(result.map((r) => r.id)).toEqual([a.id, b.id]);
      expect(w.clients.get(b.id)?.deletedAt).not.toBeNull();
    });

    it('is all or nothing: one locked client leaves the whole selection untouched', async () => {
      const w = createWorld();
      const free = w.seedClient({}, 1).client;
      const locked = w.seedClient().client;
      w.clients.activeProjects.add(locked.id);
      const error = await rejection(
        w.archiveClients.execute(w.owner, { ids: [free.id, locked.id], confirm: false }),
      );
      expect(error.code).toBe('INTEGRITY_LOCK');
      expect(w.clients.get(free.id)?.deletedAt).toBeNull();
      expect(w.contacts.rows.every((c) => c.deletedAt === null)).toBe(true);
    });

    it('rolls back the writes already made when a later client is unknown', async () => {
      const w = createWorld();
      const first = w.seedClient().client;
      const error = await rejection(
        w.archiveClients.execute(w.owner, { ids: [first.id, 'cli_nope'], confirm: true }),
      );
      expect(error.code).toBe('NOT_FOUND');
      expect(w.clients.get(first.id)?.deletedAt).toBeNull();
    });
  });

  it('is FORBIDDEN for Member and Viewer', async () => {
    const w = createWorld();
    const { client } = w.seedClient();
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.archiveClients.execute(user, { ids: [client.id], confirm: true }))).code,
      ).toBe('FORBIDDEN');
    }
  });
});
