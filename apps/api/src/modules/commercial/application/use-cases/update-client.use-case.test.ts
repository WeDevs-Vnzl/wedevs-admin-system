import { describe, expect, it } from 'vitest';
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
