import { describe, expect, it } from 'vitest';
import { STAMP } from '../../../../../test/commercial/clients/fixtures';
import { clientInput, createWorld, rejection } from '../../../../../test/commercial/clients/world';

describe('CreateClient', () => {
  it('allocates the next CLI code, defaults to PROSPECTO and logs CREATE with the clientId (CA2, CA4)', async () => {
    const w = createWorld();
    const created = await w.createClient.execute(w.owner, clientInput());
    expect(created.client).toMatchObject({
      code: 'CLI-0001',
      status: 'PROSPECTO',
      activatedAt: null,
      deletedAt: null,
      tradeName: 'Nube Austral',
      taxId: 'J-40111222-3',
    });
    expect(created.contacts).toEqual([]);
    const second = await w.createClient.execute(w.owner, clientInput({ taxId: 'J-40111222-4' }));
    expect(second.client.code).toBe('CLI-0002');

    expect(w.activity.entries[0]).toMatchObject({
      actor: { actorType: 'USER', userId: w.owner.userId },
      action: 'CREATE',
      entityType: 'CLIENT',
      entityId: created.client.id,
      entityLabel: 'Nube Austral',
      clientId: created.client.id,
      metadata: { code: 'CLI-0001' },
    });
  });

  it('writes the search entry and the ClientMetrics row in the same unit of work (CA4)', async () => {
    const w = createWorld();
    const { client } = await w.createClient.execute(w.owner, clientInput());
    expect(w.search.get('CLIENT', client.id)).toEqual({
      entityType: 'CLIENT',
      entityId: client.id,
      code: 'CLI-0001',
      title: 'Nube Austral',
      subtitle: 'Nube Austral C.A.',
      body: 'J-40111222-3',
      status: 'PROSPECTO',
      archived: false,
    });
    expect(w.metrics.get(client.id)).toMatchObject({ projectCount: 0 });
    expect(w.clients.get(client.id)).toEqual(client);
  });

  it("stores a PERSONA's legal name as the trade name and the canonical RIF", async () => {
    const w = createWorld();
    const { client } = await w.createClient.execute(
      w.owner,
      clientInput({ kind: 'PERSONA', legalName: undefined, taxId: 'v123456789' }),
    );
    expect(client).toMatchObject({ legalName: 'Nube Austral', taxId: 'V-12345678-9' });
  });

  it('sets activatedAt when created as ACTIVO', async () => {
    const w = createWorld();
    const { client } = await w.createClient.execute(w.owner, {
      ...clientInput(),
      status: 'ACTIVO',
    });
    expect(client.activatedAt).toEqual(STAMP);
  });

  it('assigns the tags through TagAssignments', async () => {
    const w = createWorld();
    w.seedTag('tag_a', 'Alfa');
    w.seedTag('tag_b', 'Beta');
    const created = await w.createClient.execute(
      w.owner,
      clientInput({ tagIds: ['tag_b', 'tag_a'] }),
    );
    expect(created.tags.map((tag) => tag.name).sort()).toEqual(['Alfa', 'Beta']);
    expect(
      w.assignmentRepo.committedIds({ entityType: 'CLIENT', entityId: created.client.id }).sort(),
    ).toEqual(['tag_a', 'tag_b']);
  });

  it('answers CONFLICT linking the holder when a live client has the same tax id and country (CA3)', async () => {
    const w = createWorld();
    const kairos = w.seedClient({
      id: 'cli_kairos',
      code: 'CLI-0007',
      tradeName: 'Kairos Studio',
      taxId: 'J-30123456-7',
    });
    const error = await rejection(
      w.createClient.execute(w.owner, clientInput({ taxId: 'j301234567', country: 'VE' })),
    );
    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'clients.errors.duplicateTaxId',
      entity: { id: kairos.client.id, type: 'CLIENT', code: 'CLI-0007', label: 'Kairos Studio' },
    });
    expect(w.clients.rows).toHaveLength(1);
    expect(w.activity.entries).toHaveLength(0);
    // The sequence was not consumed by the failed attempt.
    const next = await w.createClient.execute(w.owner, clientInput());
    expect(next.client.code).toBe('CLI-0001');
  });

  it('allows the same tax id in another country and after the holder is archived', async () => {
    const w = createWorld();
    w.seedClient({ taxId: 'J-30123456-7' });
    const abroad = await w.createClient.execute(
      w.owner,
      clientInput({ taxId: 'J-30123456-7', country: 'CO' }),
    );
    expect(abroad.client.country).toBe('CO');
    w.seedClient({ taxId: 'J-50000000-1', deletedAt: STAMP });
    const reused = await w.createClient.execute(w.owner, clientInput({ taxId: 'J-50000000-1' }));
    expect(reused.client.taxId).toBe('J-50000000-1');
  });

  it('rejects an unknown tag id with VALIDATION and rolls everything back', async () => {
    const w = createWorld();
    const error = await rejection(
      w.createClient.execute(w.owner, clientInput({ tagIds: ['tag_nope'] })),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors).toHaveProperty('tagIds');
    expect(w.clients.rows).toHaveLength(0);
    expect(w.search.size).toBe(0);
    expect((await w.createClient.execute(w.owner, clientInput())).client.code).toBe('CLI-0001');
  });

  it('rejects an invalid form with VALIDATION before touching anything (CA1)', async () => {
    const w = createWorld();
    const error = await rejection(w.createClient.execute(w.owner, clientInput({ legalName: ' ' })));
    expect(error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { legalName: ['validation.required'] },
    });
    expect(w.uow.lastOptions).toBeUndefined();
  });

  it('runs Serializable and is allowed for Owner, Admin; Member and Viewer are FORBIDDEN', async () => {
    const w = createWorld();
    await w.createClient.execute(w.admin, clientInput());
    expect(w.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    for (const user of [w.member, w.viewer]) {
      expect(
        (await rejection(w.createClient.execute(user, clientInput({ taxId: 'J-1' })))).code,
      ).toBe('FORBIDDEN');
    }
  });
});
