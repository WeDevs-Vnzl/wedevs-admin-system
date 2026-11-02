import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../../../shared/application/actor';
import { ConflictError, ForbiddenError } from '../../../../../shared/domain/domain-error';
import {
  MapSource,
  buildSearchWorld,
  entry,
} from '../../../../../../test/intelligence/search/world';
import { ReindexAll } from './reindex-all.use-case';
import { ReindexEntity } from './reindex-entity.use-case';

function build() {
  const w = buildSearchWorld();
  const clients = new MapSource('CLIENT');
  const notes = new MapSource('NOTE');
  w.registry.register(clients);
  w.registry.register(notes);
  return {
    ...w,
    clients,
    notes,
    reindexEntity: new ReindexEntity(w.uow, w.registry, w.index, w.index),
    reindexAll: new ReindexAll(w.uow, w.registry, w.index, w.index),
  };
}

const USER_ACTOR = { actorType: 'USER', userId: 'usr_owner' } as const;

describe('ReindexEntity', () => {
  it('is SYSTEM only', async () => {
    const { reindexEntity } = build();
    await expect(
      reindexEntity.execute(USER_ACTOR, { entityType: 'CLIENT', entityId: 'c1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('writes the entry the source implies, under Serializable', async () => {
    const { reindexEntity, clients, index, uow } = build();
    clients.add({
      entityId: 'c1',
      code: 'CLI-1',
      title: 'Kairos',
      subtitle: null,
      body: null,
      status: 'ACTIVO',
      archived: false,
    });
    const result = await reindexEntity.execute(SYSTEM_ACTOR, {
      entityType: 'CLIENT',
      entityId: 'c1',
    });
    expect(result).toEqual({ entityType: 'CLIENT', entityId: 'c1', indexed: true });
    expect(index.get('CLIENT', 'c1')?.title).toBe('Kairos');
    expect(uow.lastOptions?.isolation).toBe('Serializable');
  });

  it('reports indexed=false and removes the entry when the source is gone', async () => {
    const { reindexEntity, index } = build();
    index.seed(entry('CLIENT', 'gone'));
    const result = await reindexEntity.execute(SYSTEM_ACTOR, {
      entityType: 'CLIENT',
      entityId: 'gone',
    });
    expect(result.indexed).toBe(false);
    expect(index.get('CLIENT', 'gone')).toBeUndefined();
  });

  it('reports indexed=false for a type with no registered source', async () => {
    const { reindexEntity } = build();
    const result = await reindexEntity.execute(SYSTEM_ACTOR, {
      entityType: 'INVOICE',
      entityId: 'i1',
    });
    expect(result.indexed).toBe(false);
  });
});

describe('ReindexAll (DT-167)', () => {
  it('is SYSTEM only', async () => {
    const { reindexAll } = build();
    await expect(reindexAll.execute(USER_ACTOR)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates missing, updates different, leaves same, removes orphans, and counts per type', async () => {
    const { reindexAll, clients, notes, index } = build();
    clients.add({
      entityId: 'c_new',
      code: null,
      title: 'New',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    clients.add({
      entityId: 'c_same',
      code: null,
      title: 'Same',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    clients.add({
      entityId: 'c_diff',
      code: null,
      title: 'Fresh label',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    notes.add({
      entityId: 'n1',
      code: null,
      title: 'Nota',
      subtitle: null,
      body: 'x',
      status: null,
      archived: true,
    });
    index.seed(entry('CLIENT', 'c_same', { title: 'Same' }));
    index.seed(entry('CLIENT', 'c_diff', { title: 'Stale label' }));
    index.seed(entry('CLIENT', 'c_orphan'));
    index.seed(entry('INVOICE', 'untouched'));

    const result = await reindexAll.execute(SYSTEM_ACTOR);

    expect(result.CLIENT).toEqual({
      scanned: 3,
      created: 1,
      updated: 1,
      unchanged: 1,
      removed: 1,
      skippedIds: [],
    });
    expect(result.NOTE).toEqual({
      scanned: 1,
      created: 1,
      updated: 0,
      unchanged: 0,
      removed: 0,
      skippedIds: [],
    });
    expect(result.INVOICE).toBeUndefined();
    expect(index.get('CLIENT', 'c_diff')?.title).toBe('Fresh label');
    expect(index.get('CLIENT', 'c_orphan')).toBeUndefined();
    expect(index.get('NOTE', 'n1')?.archived).toBe(true);
    // A type without a registered source is not walked, so its entries are never removed.
    expect(index.get('INVOICE', 'untouched')).toBeDefined();
  });

  it('does not write an entry that already matches (a second run writes nothing)', async () => {
    const { reindexAll, clients, index } = build();
    clients.add({
      entityId: 'c1',
      code: null,
      title: 'A',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    await reindexAll.execute(SYSTEM_ACTOR);
    const writes = index.upserts;
    const second = await reindexAll.execute(SYSTEM_ACTOR);
    expect(index.upserts).toBe(writes);
    expect(second.CLIENT).toMatchObject({ unchanged: 1, created: 0, updated: 0 });
  });

  it('walks more than one page of ids and of orphans', async () => {
    const { reindexAll, clients, index } = build();
    for (let i = 0; i < 450; i += 1) {
      clients.add({
        entityId: `c${String(i).padStart(4, '0')}`,
        code: null,
        title: `T${i}`,
        subtitle: null,
        body: null,
        status: null,
        archived: false,
      });
    }
    for (let i = 0; i < 250; i += 1)
      index.seed(entry('CLIENT', `z_orphan_${String(i).padStart(4, '0')}`));
    const result = await reindexAll.execute(SYSTEM_ACTOR);
    expect(result.CLIENT).toMatchObject({ scanned: 450, created: 450, removed: 250 });
    expect(index.size).toBe(450);
  });

  it('puts a CONFLICT in skippedIds and keeps going (DT-129 pattern)', async () => {
    const { reindexAll, clients, index } = build();
    clients.add({
      entityId: 'c1',
      code: null,
      title: 'A',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    clients.add({
      entityId: 'c2',
      code: null,
      title: 'B',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    const original = clients.entryOf.bind(clients);
    clients.entryOf = async (id: string) => {
      if (id === 'c1') throw new ConflictError();
      return original(id);
    };
    const result = await reindexAll.execute(SYSTEM_ACTOR);
    expect(result.CLIENT).toMatchObject({ scanned: 2, created: 1, skippedIds: ['c1'] });
    expect(index.get('CLIENT', 'c1')).toBeUndefined();
    expect(index.get('CLIENT', 'c2')).toBeDefined();
  });

  it('lets any other error through', async () => {
    const { reindexAll, clients } = build();
    clients.add({
      entityId: 'c1',
      code: null,
      title: 'A',
      subtitle: null,
      body: null,
      status: null,
      archived: false,
    });
    clients.failWith = new Error('db down');
    await expect(reindexAll.execute(SYSTEM_ACTOR)).rejects.toThrow('db down');
  });
});
