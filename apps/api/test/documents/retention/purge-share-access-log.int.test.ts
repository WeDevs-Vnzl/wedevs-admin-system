import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PurgeShareAccessLog } from '../../../src/modules/documents/application/use-cases/shares/purge-share-access-log.use-case';
import { PrismaShareAccessLog } from '../../../src/modules/documents/infrastructure/prisma-share-access-log';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';

const SYSTEM = { actorType: 'SYSTEM', userId: null } as const;
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const log = new PrismaShareAccessLog(host);
const activity = new PrismaActivityLog(host, new PrismaClientMetricsWriter(host));

const NOW = '2026-10-30T12:00:00.000Z';
const CUTOFF = new Date('2024-10-30T04:00:00.000Z');
const purgeWith = (options?: { batchSize: number; maxBatches: number }) =>
  new PurgeShareAccessLog(uow, log, activity, new FixedClock(NOW), options);

let seq = 0;
async function seed(createdAt: Date, event: 'VIEW' | 'UNLOCK_FAILED' = 'VIEW'): Promise<string> {
  seq += 1;
  const id = `acc_${seq}`;
  await admin.shareAccessLog.create({
    data: { id, shareLinkId: 'shr_a', event, ipHash: 'h'.repeat(64), createdAt },
  });
  return id;
}
const remaining = async () =>
  (await admin.shareAccessLog.findMany({ orderBy: { createdAt: 'asc' } })).map((r) => r.id);

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  seq = 0;
  const user = await admin.user.create({
    data: { clerkId: 'user_ret', email: 'ret@example.test', name: 'Autora', role: 'OWNER' },
  });
  await admin.shareLink.create({
    data: { id: 'shr_a', token: 'a'.repeat(43), title: 'Enlace', createdById: user.id },
  });
});

describe('PurgeShareAccessLog over PostgreSQL', () => {
  it('deletes strictly before the cutoff and never the row at it or after it', async () => {
    const old = await seed(new Date(CUTOFF.getTime() - 1));
    const veryOld = await seed(new Date('2020-01-01T00:00:00Z'));
    const atCutoff = await seed(CUTOFF);
    const justAfter = await seed(new Date(CUTOFF.getTime() + 1));
    const recent = await seed(new Date('2026-10-30T11:55:00Z'), 'UNLOCK_FAILED');

    const result = await purgeWith().execute(SYSTEM);

    expect(result).toMatchObject({ deleted: 2, batches: 1 });
    expect(await remaining()).toEqual([atCutoff, justAfter, recent]);
    expect(old).not.toBe(veryOld);
  });

  it('works in batches, oldest first, bounded per run, and a rerun changes nothing', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) ids.push(await seed(new Date(Date.UTC(2020, 0, 1, 0, i))));
    const keep = await seed(new Date('2026-10-01T00:00:00Z'));

    const first = await purgeWith({ batchSize: 3, maxBatches: 2 }).execute(SYSTEM);
    expect(first).toMatchObject({ deleted: 6, batches: 2 });
    expect(await remaining()).toEqual([ids[6], keep]);

    expect(await purgeWith({ batchSize: 3, maxBatches: 2 }).execute(SYSTEM)).toMatchObject({
      deleted: 1,
      batches: 1,
    });
    const jobs = await admin.activityLog.count({ where: { action: 'SYSTEM_JOB' } });
    const rerun = await purgeWith().execute(SYSTEM);
    expect(rerun.deleted).toBe(0);
    expect(await remaining()).toEqual([keep]);
    expect(await admin.activityLog.count({ where: { action: 'SYSTEM_JOB' } })).toBe(jobs);
  });

  it('writes one SYSTEM_JOB entry per run that deleted rows, with the count', async () => {
    await seed(new Date('2020-01-01T00:00:00Z'));
    await seed(new Date('2020-01-02T00:00:00Z'));
    await purgeWith().execute(SYSTEM);
    const entries = await admin.activityLog.findMany({ where: { action: 'SYSTEM_JOB' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorType: 'SYSTEM',
      entityType: 'SETTING',
      entityId: 'purge-share-access-log',
    });
    expect(entries[0]?.metadata).toMatchObject({ deleted: 2, batches: 1 });
  });

  it('does not move the stored counters of the link (BE-4 choice 4)', async () => {
    await admin.shareLink.update({
      where: { id: 'shr_a' },
      data: { viewCount: 5, downloadCount: 2, lastAccessedAt: new Date('2020-01-01T00:00:00Z') },
    });
    await seed(new Date('2020-01-01T00:00:00Z'));
    await purgeWith().execute(SYSTEM);
    expect(await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } })).toMatchObject({
      viewCount: 5,
      downloadCount: 2,
    });
  });
});
