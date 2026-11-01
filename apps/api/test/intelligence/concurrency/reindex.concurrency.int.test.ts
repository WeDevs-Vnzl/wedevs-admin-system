import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SearchIndexMaintenancePort } from '../../../src/modules/intelligence/application/ports/search-read.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { seedClient } from '../../commercial/concurrency/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { Gate, buildWorld, gated, interleave, seedIndexedClient } from './world';

/**
 * Package 2.2 (DT-166, DT-167): `ReindexAll` and `ReindexEntity` rebuild a row of a table every mutation
 * also writes. Each test pauses the reindex after it compared an entry (so it has decided to write the old
 * label), commits a rename in between, and lets the reindex go on. With `Serializable` its write fails
 * (`40001`), is retried and reads the new label; without it (`REINDEX_RED=1`, `ReadCommitted`) the old
 * label overwrites the rename and two runs both claim to have created the same entry.
 */
const RED = process.env.REINDEX_RED === '1';
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

const readCommitted = (uow: UnitOfWorkPort): UnitOfWorkPort => ({
  run: (work) => uow.run(work, { isolation: 'ReadCommitted' }),
});
const hooks = (gate: Gate) => ({
  ...(RED ? { uow: readCommitted } : {}),
  maintenance: (port: SearchIndexMaintenancePort) => gated(port, gate, ['compare'], 'after'),
});
const titleOf = async (id: string) =>
  (
    await admin.searchEntry.findUniqueOrThrow({
      where: { entityType_entityId: { entityType: 'CLIENT', entityId: id } },
    })
  ).title;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await seedClient(admin, 'cli_a');
  await seedClient(admin, 'cli_b');
  await seedClient(admin, 'cli_c');
}, 60_000);

describe('rename vs reindex of one entity: the new label survives', () => {
  it('ReindexEntity', async () => {
    await seedIndexedClient(admin, 'cli_a', { tradeName: 'Old Name', entryTitle: 'Stale Name' });
    const gate = new Gate();
    const world = buildWorld(service, hooks(gate));
    const [reindex, rename] = await interleave(
      admin,
      gate,
      () => world.reindexEntity.execute(SYSTEM_ACTOR, { entityType: 'CLIENT', entityId: 'cli_a' }),
      () => world.renameClient('cli_a', 'New Name'),
    );
    expect(rename.status).toBe('fulfilled');
    expect(reindex.status).toBe('fulfilled');
    expect((await admin.client.findUniqueOrThrow({ where: { id: 'cli_a' } })).tradeName).toBe(
      'New Name',
    );
    expect(await titleOf('cli_a')).toBe('New Name');
  });

  it('ReindexAll, which also reports nothing skipped', async () => {
    await seedIndexedClient(admin, 'cli_a', { tradeName: 'Old Name', entryTitle: 'Stale Name' });
    await seedIndexedClient(admin, 'cli_b', { tradeName: 'Beta', entryTitle: 'Beta' });
    await seedIndexedClient(admin, 'cli_c', { tradeName: 'Gamma', entryTitle: 'Gamma' });
    const gate = new Gate();
    const world = buildWorld(service, hooks(gate));
    const [reindex, rename] = await interleave(
      admin,
      gate,
      () => world.reindexAll.execute(SYSTEM_ACTOR),
      () => world.renameClient('cli_a', 'New Name'),
    );
    expect(rename.status).toBe('fulfilled');
    expect(reindex.status).toBe('fulfilled');
    expect(await titleOf('cli_a')).toBe('New Name');
    expect(await titleOf('cli_b')).toBe('Beta');
    if (reindex.status === 'fulfilled') {
      expect((reindex.value as { CLIENT: { skippedIds: string[] } }).CLIENT.skippedIds).toEqual([]);
    }
  });
});

describe('two runs of ReindexAll: no duplicates, no 500', () => {
  it('each entry is created once and the other run finds it unchanged', async () => {
    const gate = new Gate();
    const slow = buildWorld(service, hooks(gate));
    const fast = buildWorld(service, RED ? { uow: readCommitted } : {});
    const [first, second] = await interleave(
      admin,
      gate,
      () => slow.reindexAll.execute(SYSTEM_ACTOR),
      () => fast.reindexAll.execute(SYSTEM_ACTOR),
    );
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');
    expect(await admin.searchEntry.count({ where: { entityType: 'CLIENT' } })).toBe(3);
    const created = [first, second].reduce(
      (sum, run) =>
        sum +
        (run.status === 'fulfilled'
          ? (run.value as { CLIENT: { created: number } }).CLIENT.created
          : 0),
      0,
    );
    expect(created).toBe(3);
  });
});
