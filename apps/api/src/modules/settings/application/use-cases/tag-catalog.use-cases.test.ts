import { describe, expect, it } from 'vitest';
import { createWorld, query, userOf } from '../../../../../test/settings/tags/world';

describe('ListTags / GetTag', () => {
  it('lists every tag with usage and sorts by usageCount desc', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha');
    w.seedTag('t_b', 'Beta');
    await w.uow.run(async () => {
      await w.assignments.add({ entityType: 'CLIENT', entityId: 'c1' }, ['t_b']);
      await w.assignments.add({ entityType: 'CLIENT', entityId: 'c2' }, ['t_b']);
      await w.assignments.add({ entityType: 'PROJECT', entityId: 'p1' }, ['t_a', 't_b']);
    });
    const page = await w.listTags.execute(
      userOf('VIEWER'),
      query({ sort: { field: 'usageCount', direction: 'desc' } }),
    );
    expect(page.total).toBe(2);
    expect(page.items.map((r) => [r.id, r.usageCount])).toEqual([
      ['t_b', 3],
      ['t_a', 1],
    ]);
  });

  it('counts live records only (archived targets are excluded)', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha');
    await w.uow.run(async () => {
      await w.assignments.add({ entityType: 'CLIENT', entityId: 'c1' }, ['t_a']);
      await w.assignments.add({ entityType: 'CLIENT', entityId: 'c2' }, ['t_a']);
    });
    w.archived.add('CLIENT:c2');
    expect((await w.getTag.execute(userOf('MEMBER'), { id: 't_a' })).usageCount).toBe(1);
  });

  it('with an entityType facet keeps only tags used by those types, counting only them', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha');
    w.seedTag('t_b', 'Beta');
    await w.uow.run(async () => {
      await w.assignments.add({ entityType: 'CLIENT', entityId: 'c1' }, ['t_a']);
      await w.assignments.add({ entityType: 'PROJECT', entityId: 'p1' }, ['t_a', 't_b']);
    });
    const page = await w.listTags.execute(
      userOf('ADMIN'),
      query({ filters: { entityType: 'PROJECT' } }),
    );
    expect(page.items.map((r) => [r.id, r.usageCount])).toEqual([
      ['t_a', 1],
      ['t_b', 1],
    ]);
    const onlyClients = await w.listTags.execute(
      userOf('ADMIN'),
      query({ filters: { entityType: ['CLIENT'] } }),
    );
    expect(onlyClients.items.map((r) => r.id)).toEqual(['t_a']);
  });

  it('filters by text, accent- and case-insensitively', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Cliente clave');
    w.seedTag('t_b', 'Otra');
    const found = await w.listTags.execute(userOf('VIEWER'), query({ q: 'CLIÉNTE' }));
    expect(found.items.map((t) => t.name)).toEqual(['Cliente clave']);
  });

  it('getTag follows renames and answers NOT_FOUND for an unknown id', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha');
    await w.updateTag.execute(userOf('OWNER'), { id: 't_a', name: 'Renombrada' });
    expect((await w.getTag.execute(userOf('VIEWER'), { id: 't_a' })).name).toBe('Renombrada');
    await expect(w.getTag.execute(userOf('VIEWER'), { id: 'tag_missing' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('CreateTag', () => {
  it('creates a trimmed tag with a generated id, no usage and a CREATE entry', async () => {
    const w = createWorld();
    const created = await w.createTag.execute(userOf('ADMIN'), {
      name: '  Nuevo  ',
      color: '#123456',
    });
    expect(created).toMatchObject({
      id: 'tag_1',
      name: 'Nuevo',
      color: '#123456',
      usageCount: 0,
      createdAt: w.clock.now(),
    });
    expect(w.tagRepo.rows).toHaveLength(1);
    expect(w.activity.entries).toMatchObject([
      {
        action: 'CREATE',
        entityType: 'TAG',
        entityId: 'tag_1',
        entityLabel: 'Nuevo',
        actor: { actorType: 'USER', userId: 'usr_admin' },
      },
    ]);
  });

  it('rejects a duplicate name case-insensitively with CONFLICT pointing at the holder', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Cliente clave');
    await expect(
      w.createTag.execute(userOf('OWNER'), { name: 'CLIENTE CLAVE', color: '#000000' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: ['tags.errors.nameTaken'] },
      entity: { type: 'TAG', id: 't_a', label: 'Cliente clave' },
    });
    expect(w.activity.entries).toHaveLength(0);
  });

  it('validates name and colour', async () => {
    const w = createWorld();
    await expect(
      w.createTag.execute(userOf('OWNER'), { name: '  ', color: '#000000' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      w.createTag.execute(userOf('OWNER'), { name: 'ok', color: 'red' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { color: ['validation.invalidFormat'] },
    });
  });

  it('follows CREATE_TAG_GRANTS: Owner, Admin and Member may create; Viewer may not', async () => {
    const w = createWorld();
    for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const) {
      await expect(
        w.createTag.execute(userOf(role), { name: `Tag ${role}`, color: '#000000' }),
      ).resolves.toMatchObject({ name: `Tag ${role}` });
    }
    await expect(
      w.createTag.execute(userOf('VIEWER'), { name: 'Nope', color: '#000000' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('UpdateTag', () => {
  it('renames and recolours, keeping its own name unique (a case change of itself is fine)', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha', '#000000');
    const updated = await w.updateTag.execute(userOf('ADMIN'), {
      id: 't_a',
      name: 'ALPHA',
      color: '#abcdef',
    });
    expect(updated).toMatchObject({ id: 't_a', name: 'ALPHA', color: '#abcdef' });
    expect(w.activity.entries).toMatchObject([
      {
        action: 'UPDATE',
        entityType: 'TAG',
        entityLabel: 'ALPHA',
        changes: { name: ['Alpha', 'ALPHA'], color: ['#000000', '#abcdef'] },
      },
    ]);
  });

  it('writes no activity when nothing changed', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha', '#000000');
    await w.updateTag.execute(userOf('OWNER'), { id: 't_a', name: ' Alpha ', color: '#000000' });
    expect(w.activity.entries).toHaveLength(0);
  });

  it('refuses a name another tag holds', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha');
    w.seedTag('t_b', 'Beta');
    await expect(
      w.updateTag.execute(userOf('OWNER'), { id: 't_a', name: 'beta' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      entity: { type: 'TAG', id: 't_b', label: 'Beta' },
    });
  });

  it('answers NOT_FOUND for an unknown tag and FORBIDDEN for Member and Viewer (update settings)', async () => {
    const w = createWorld();
    w.seedTag('t_a', 'Alpha');
    await expect(
      w.updateTag.execute(userOf('OWNER'), { id: 'tag_missing', color: '#000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      await expect(
        w.updateTag.execute(userOf(role), { id: 't_a', name: 'X' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
