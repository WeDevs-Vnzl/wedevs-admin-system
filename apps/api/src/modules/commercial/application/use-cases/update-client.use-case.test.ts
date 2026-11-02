import { describe, expect, it, vi } from 'vitest';
import { projectRecord } from '../../../../../test/commercial/projects/fakes/world';
import { clientInput, createWorld, rejection } from '../../../../../test/commercial/clients/world';

async function setup() {
  const w = createWorld();
  const created = await w.createClient.execute(w.owner, clientInput());
  return { w, client: created.client };
}

describe('UpdateClient', () => {
  it("applies the change and logs an UPDATE with the field diff, long text as 'changed'", async () => {
    const { w, client } = await setup();
    w.clock.advance(60_000);
    const updated = await w.updateClient.execute(w.owner, {
      ...clientInput({
        tradeName: 'Nube Austral Pro',
        address: 'Otra dirección',
        email: 'hola@nube.example.com',
      }),
      id: client.id,
    });
    expect(updated.client.tradeName).toBe('Nube Austral Pro');
    expect(updated.client.updatedAt).toEqual(w.clock.now());
    expect(w.activity.entries.at(-1)).toMatchObject({
      action: 'UPDATE',
      entityId: client.id,
      entityLabel: 'Nube Austral Pro',
      clientId: client.id,
      changes: {
        tradeName: ['Nube Austral', 'Nube Austral Pro'],
        address: 'changed',
        email: [null, 'hola@nube.example.com'],
      },
    });
  });

  it('reindexes the client after a change', async () => {
    const { w, client } = await setup();
    await w.updateClient.execute(w.owner, { ...clientInput({ tradeName: 'Otro' }), id: client.id });
    expect(w.search.get('CLIENT', client.id)).toMatchObject({ title: 'Otro' });
  });

  it('does not log, write or reindex anything when nothing changed', async () => {
    const { w, client } = await setup();
    const entries = w.activity.entries.length;
    w.clock.advance(60_000);
    const result = await w.updateClient.execute(w.owner, { ...clientInput(), id: client.id });
    expect(w.activity.entries).toHaveLength(entries);
    expect(result.client.updatedAt).toEqual(client.updatedAt);
  });

  it('answers CONFLICT with the holder when the new tax id belongs to another live client', async () => {
    const { w, client } = await setup();
    const other = w.seedClient({ id: 'cli_other', taxId: 'J-30123456-7' });
    const error = await rejection(
      w.updateClient.execute(w.owner, { ...clientInput({ taxId: 'J-30123456-7' }), id: client.id }),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'clients.errors.duplicateTaxId',
      entity: { id: other.client.id },
    });
  });

  it('lets a client keep its own tax id', async () => {
    const { w, client } = await setup();
    const updated = await w.updateClient.execute(w.owner, {
      ...clientInput({ website: 'https://nube.example.com' }),
      id: client.id,
    });
    expect(updated.client.website).toBe('https://nube.example.com');
  });

  it('answers NOT_FOUND for an unknown or archived client', async () => {
    const { w } = await setup();
    const archived = w.seedClient({ deletedAt: new Date() }).client;
    for (const id of ['cli_nope', archived.id]) {
      expect(
        (await rejection(w.updateClient.execute(w.owner, { ...clientInput(), id }))).code,
      ).toBe('NOT_FOUND');
    }
  });

  it('logs sorted tag names joined with ", ", never ids (CR-B4, C1)', async () => {
    const { w, client } = await setup();
    w.seedTag('tag_z', 'zeta');
    w.seedTag('tag_a', 'Álamo');
    await w.updateClient.execute(w.owner, {
      ...clientInput({ tagIds: ['tag_z', 'tag_a'] }),
      id: client.id,
    });
    const entry = w.activity.entries.at(-1);
    expect(entry?.changes).toEqual({ tagIds: ['', 'Álamo, zeta'] });
    expect(JSON.stringify(entry?.changes)).not.toMatch(/tag_/);
  });

  it('runs Serializable and is FORBIDDEN for Member and Viewer', async () => {
    const { w, client } = await setup();
    await w.updateClient.execute(w.owner, { ...clientInput({ tradeName: 'X' }), id: client.id });
    expect(w.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.updateClient.execute(user, { ...clientInput(), id: client.id }))).code,
      ).toBe('FORBIDDEN');
    }
  });
});

describe('UpdateClient rename (DT-166)', () => {
  async function renameSetup() {
    const { w, client } = await setup();
    w.projects.addClient(client.id, client.tradeName);
    w.projects.seed(
      projectRecord({
        id: 'pry_b',
        code: 'PRY-0002',
        clients: [{ clientId: client.id, role: 'Contratante', linkedAt: new Date() }],
      }),
      projectRecord({
        id: 'pry_a',
        code: 'PRY-0001',
        archivedAt: new Date(),
        clients: [{ clientId: client.id, role: 'Contratante', linkedAt: new Date() }],
      }),
      projectRecord({ id: 'pry_other', code: 'PRY-0003', clients: [] }),
    );
    vi.spyOn(w.search, 'upsert').mockImplementation(async () => {
      w.order.push('upsert');
    });
    vi.spyOn(w.sync, 'reindex').mockImplementation(async (record) => {
      w.order.push(`reindex:${record.id}`);
    });
    vi.spyOn(w.activity, 'record').mockImplementation(async () => {
      w.order.push('activity');
    });
    w.order.length = 0;
    return { w, client };
  }

  it('locks the Client row first, as the only lock', async () => {
    const { w, client } = await renameSetup();
    await w.updateClient.execute(w.owner, { ...clientInput({ tradeName: 'Otro' }), id: client.id });
    expect(w.rowLocks.acquired).toEqual([{ rowClass: 'Client', id: client.id }]);
  });

  it('on a tradeName change writes own entry, projects ascending (archived included), dependants, then activity', async () => {
    const { w, client } = await renameSetup();
    await w.updateClient.execute(w.owner, { ...clientInput({ tradeName: 'Otro' }), id: client.id });
    expect(w.order).toEqual([
      'upsert',
      'reindex:pry_a',
      'reindex:pry_b',
      'relabelClient',
      'activity',
    ]);
    expect(w.dependents.calls).toEqual([{ clientId: client.id, label: 'Otro' }]);
  });

  it('a legalName change reindexes the projects but does not relabel the dependants', async () => {
    const { w, client } = await renameSetup();
    await w.updateClient.execute(w.owner, {
      ...clientInput({ legalName: 'Nube Austral S.A.' }),
      id: client.id,
    });
    expect(w.order).toEqual(['upsert', 'reindex:pry_a', 'reindex:pry_b', 'activity']);
  });

  it('an edit that changes neither name reindexes only its own entry and calls no dependant', async () => {
    const { w, client } = await renameSetup();
    await w.updateClient.execute(w.owner, {
      ...clientInput({ email: 'x@nube.example.com', address: 'Otra' }),
      id: client.id,
    });
    expect(w.order).toEqual(['upsert', 'activity']);
  });

  it('a no-op edit still locks and writes nothing', async () => {
    const { w, client } = await renameSetup();
    await w.updateClient.execute(w.owner, { ...clientInput(), id: client.id });
    expect(w.order).toEqual([]);
  });
});
