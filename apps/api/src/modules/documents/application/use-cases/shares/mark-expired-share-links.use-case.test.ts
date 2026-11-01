import { describe, expect, it } from 'vitest';
import { must } from '../../../../../../test/documents/shares/must';
import { ConflictError } from '../../../../../shared/domain/domain-error';
import { owner, seededWorld } from '../../../../../../test/documents/shares/world';

const SYSTEM = { actorType: 'SYSTEM', userId: null } as const;
const PUBLIC = { actorType: 'PUBLIC', userId: null } as const;
const DOCS = [{ documentId: 'doc_a', versionId: null, order: 0, key: { kind: 'clear' } }] as const;

function worldWithLinks() {
  const world = seededWorld();
  world.clock.set('2026-10-30T12:00:00.000Z');
  world.seedLink({ id: 'past', expiresAt: '2026-10-20' }, DOCS);
  world.seedLink({ id: 'today', expiresAt: '2026-10-30' }, DOCS);
  world.seedLink({ id: 'future', expiresAt: '2026-11-30' }, DOCS);
  world.seedLink({ id: 'never' }, DOCS);
  world.seedLink(
    { id: 'revoked', expiresAt: '2026-10-01', revokedAt: new Date('2026-10-05') },
    DOCS,
  );
  world.seedLink(
    { id: 'marked', expiresAt: '2026-10-01', expiredAt: new Date('2026-10-02') },
    DOCS,
  );
  return world;
}

describe('MarkExpiredShareLinks (DT-137)', () => {
  it('marks only expired, unrevoked, unmarked links and logs one SYSTEM_JOB per link', async () => {
    const world = worldWithLinks();
    const result = await world.markExpired.execute(SYSTEM);

    expect(result).toEqual({ updated: 1, shareLinkIds: ['past'], skippedIds: [] });
    expect(must(await world.shares.findById('past')).expiredAt).toEqual(world.clock.now());
    for (const id of ['today', 'future', 'never', 'revoked']) {
      expect(must(await world.shares.findById(id)).expiredAt).toBeNull();
    }
    expect(world.activity.entries).toHaveLength(1);
    expect(world.activity.entries[0]).toMatchObject({
      action: 'SYSTEM_JOB',
      entityType: 'SHARE_LINK',
      entityId: 'past',
      entityLabel: 'Enlace past',
      actor: SYSTEM,
      metadata: { expiresAt: '2026-10-20' },
    });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(world.locks.acquired).toEqual([{ rowClass: 'ShareLink', id: 'past' }]);
  });

  it('changes nothing on a rerun, however many days passed', async () => {
    const world = worldWithLinks();
    await world.markExpired.execute(SYSTEM);
    world.clock.advance(40 * 86_400_000);
    const entries = world.activity.entries.length;

    // Now `today` and `future` are long expired and get marked once; `past` is not marked again.
    const second = await world.markExpired.execute(SYSTEM);
    expect(second.shareLinkIds).toEqual(['future', 'today']);
    const third = await world.markExpired.execute(SYSTEM);
    expect(third).toEqual({ updated: 0, shareLinkIds: [], skippedIds: [] });
    expect(world.activity.entries).toHaveLength(entries + 2);
  });

  it('lets a person who revoked or renewed the link meanwhile win (locked recheck)', async () => {
    const world = worldWithLinks();
    const original = world.shares.expiredIds.bind(world.shares);
    // The candidate list is stale: `future` is not expired and `revoked` is revoked, yet both are listed.
    world.shares.expiredIds = async (today) => [
      ...(await original(today)),
      'future',
      'revoked',
      'gone',
    ];
    const result = await world.markExpired.execute(SYSTEM);
    expect(result.shareLinkIds).toEqual(['past']);
  });

  it('skips a link that hits a CONFLICT and goes on with the rest (DT-129)', async () => {
    const world = worldWithLinks();
    world.seedLink({ id: 'past2', expiresAt: '2026-10-21' }, DOCS);
    const markExpired = world.shares.markExpired.bind(world.shares);
    world.shares.markExpired = async (id, at) => {
      if (id === 'past') throw new ConflictError();
      return markExpired(id, at);
    };
    const result = await world.markExpired.execute(SYSTEM);
    expect(result).toEqual({ updated: 1, shareLinkIds: ['past2'], skippedIds: ['past'] });
    expect(must(await world.shares.findById('past')).expiredAt).toBeNull();
  });

  it('aborts the run on any other error', async () => {
    const world = worldWithLinks();
    world.shares.markExpired = async () => {
      throw new Error('boom');
    };
    await expect(world.markExpired.execute(SYSTEM)).rejects.toThrow('boom');
  });

  it('is FORBIDDEN for every actor but SYSTEM, writing nothing', async () => {
    const world = worldWithLinks();
    for (const actor of [PUBLIC, { actorType: 'USER', userId: owner.userId }] as const) {
      await expect(world.markExpired.execute(actor)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(world.shares.writeCount).toBe(0);
    expect(world.activity.entries).toHaveLength(0);
  });
});
