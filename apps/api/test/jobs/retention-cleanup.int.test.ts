import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { bootJobsWorld, SYSTEM_JOB_SUMMARIES, type JobsWorld } from './world';

/** `RunRetention` (DT-74, A4, A9) and `RunCleanupFiles` (DT-145) over the real worker graph. */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
let world: JobsWorld;
let userId = '';

beforeAll(async () => {
  world = await bootJobsWorld('2026-10-29T15:00:00.000Z');
}, 120_000);
afterAll(async () => {
  await world.close();
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  world.clock.set('2026-10-29T15:00:00.000Z');
  userId = (
    await admin.user.create({
      data: { clerkId: 'user_ret', email: 'ret@example.test', name: 'Owner', role: 'OWNER' },
    })
  ).id;
});

const hoursAgo = (hours: number) =>
  new Date(Date.parse('2026-10-29T15:00:00.000Z') - hours * 3_600_000);

async function seedAccessLog() {
  await admin.shareLink.create({
    data: { id: 'shr_a', token: 'a'.repeat(43), title: 'Enlace', createdById: userId },
  });
  const row = (id: string, createdAt: Date) =>
    admin.shareAccessLog.create({
      data: { id, shareLinkId: 'shr_a', event: 'VIEW', ipHash: 'i'.repeat(64), createdAt },
    });
  await row('acc_old1', new Date('2024-01-05T12:00:00Z'));
  await row('acc_old2', new Date('2024-10-28T12:00:00Z')); // before the cutoff day (2024-10-29, Caracas)
  await row('acc_edge', new Date('2024-10-29T04:00:00Z')); // exactly the cutoff instant: kept
  await row('acc_new', new Date('2026-09-01T12:00:00Z'));
}

const purgeEntries = () =>
  admin.activityLog.findMany({
    where: { entityType: 'SETTING', entityId: 'purge-share-access-log' },
  });

describe('RunRetention', () => {
  it('purges rows older than 24 months and leaves exactly one summary entry for the run', async () => {
    await seedAccessLog();

    await world.retention.execute();

    expect(
      (await admin.shareAccessLog.findMany({ orderBy: { id: 'asc' } })).map((r) => r.id),
    ).toEqual(['acc_edge', 'acc_new']);
    const entries = await purgeEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toMatchObject({ deleted: 2 });
  });

  it('a rerun deletes nothing and adds one summary entry, not two (A4)', async () => {
    await seedAccessLog();
    await world.retention.execute();

    await world.retention.execute();

    expect(await admin.shareAccessLog.count()).toBe(2);
    const entries = await purgeEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => (e.metadata as { deleted: number }).deleted).sort()).toEqual([0, 2]);
    expect(await SYSTEM_JOB_SUMMARIES(admin)).toBe(2);
  });
});

describe('RunCleanupFiles', () => {
  const file = (
    id: string,
    over: { status?: 'PENDING' | 'READY'; createdAt: Date; deletedAt?: Date },
  ) =>
    admin.file.create({
      data: {
        id,
        storageKey: `documents/${id}`,
        bucket: 'memory',
        originalName: `${id}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: over.status ?? 'PENDING',
        uploadedById: userId,
        createdAt: over.createdAt,
        deletedAt: over.deletedAt ?? null,
      },
    });

  async function seedFiles() {
    await file('fil_stale', { createdAt: hoursAgo(30) });
    await file('fil_fresh', { createdAt: hoursAgo(2) });
    await file('fil_ready', { status: 'READY', createdAt: hoursAgo(300) });
    await file('fil_trash', { status: 'READY', createdAt: hoursAgo(300), deletedAt: hoursAgo(30) });
    await file('fil_trash_new', {
      status: 'READY',
      createdAt: hoursAgo(300),
      deletedAt: hoursAgo(2),
    });
  }

  it('removes a stale PENDING upload and an old soft-deleted file (DT-145); keeps the rest', async () => {
    await seedFiles();

    const result = await world.cleanup.execute();

    expect((await admin.file.findMany({ orderBy: { id: 'asc' } })).map((f) => f.id)).toEqual([
      'fil_fresh',
      'fil_ready',
      'fil_trash_new',
    ]);
    expect([...world.storage.destroyed].sort()).toEqual([
      'documents/fil_stale',
      'documents/fil_trash',
    ]);
    expect(result.steps[0]).toMatchObject({ status: 'ok', counts: { deleted: 2, failed: 0 } });
  });

  it('a rerun changes nothing and adds only its summary entry (A4)', async () => {
    await seedFiles();
    await world.cleanup.execute();
    const files = await admin.file.count();
    const destroyed = world.storage.destroyed.length;
    const entries = await admin.activityLog.count();

    await world.cleanup.execute();

    expect(await admin.file.count()).toBe(files);
    expect(world.storage.destroyed).toHaveLength(destroyed);
    expect(await admin.activityLog.count()).toBe(entries + 1);
    expect(
      await admin.activityLog.count({
        where: { entityType: 'SETTING', entityId: 'cleanup-files' },
      }),
    ).toBe(2);
  });

  it('a destroy failure stays for the next run and does not fail the job', async () => {
    await seedFiles();
    world.storage.failDestroy = true;
    const failed = await world.cleanup.execute();
    expect(failed.steps[0]?.counts).toMatchObject({ failed: 2 });
    expect(await admin.file.count({ where: { id: { in: ['fil_stale', 'fil_trash'] } } })).toBe(2);

    // The stale upload was soft-deleted by the failed run; DT-145 takes it again once that is 24 h old.
    world.storage.failDestroy = false;
    world.clock.advance(25 * 3_600_000);
    await world.cleanup.execute();
    expect(await admin.file.count({ where: { id: { in: ['fil_stale', 'fil_trash'] } } })).toBe(0);
  });
});
