import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/shared/application/actor';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { buildWorld } from '../finance/read-models/world';
import { seedWorld } from './seed';
import { bootJobsWorld, SYSTEM_JOB_SUMMARIES, type JobsWorld } from './world';

/**
 * `DailyMaintenance` over the real worker graph and a real database, driven by a `FixedClock`: HU-12 CA4,
 * HU-19 CA3, HU-10 CA1-CA3, the expired links, rerun safety (A4) and the DT-165 proof.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const seed = buildWorld(service);
let world: JobsWorld;

beforeAll(async () => {
  world = await bootJobsWorld('2026-10-28T15:00:00.000Z');
}, 120_000);
afterAll(async () => {
  await world.close();
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  world.clock.set('2026-10-28T15:00:00.000Z');
});

const statuses = async () => ({
  invoices: Object.fromEntries((await admin.invoice.findMany()).map((i) => [i.id, i.status])),
  documents: Object.fromEntries((await admin.document.findMany()).map((d) => [d.id, d.status])),
});
const periods = async (chargeId: string) =>
  (
    await admin.billingInstallment.findMany({
      where: { recurringChargeId: chargeId },
      orderBy: { periodStart: 'asc' },
    })
  ).map((row) => row.periodStart?.toISOString().slice(0, 10));
const metrics = async () => ({
  clients: await admin.clientMetrics.findMany({
    orderBy: { clientId: 'asc' },
    select: {
      clientId: true,
      invoicedUsd: true,
      collectedUsd: true,
      receivableUsd: true,
      overdueUsd: true,
      creditUsd: true,
    },
  }),
  projects: await admin.projectMetrics.findMany({
    orderBy: { projectId: 'asc' },
    select: {
      projectId: true,
      contractedUsd: true,
      invoicedUsd: true,
      collectedUsd: true,
      toInvoiceUsd: true,
      receivableUsd: true,
      expensesUsd: true,
      marginUsd: true,
      monthlyRecurringUsd: true,
    },
  }),
});

describe('DailyMaintenance over a real database', () => {
  it('HU-12 CA4: overdue invoices become VENCIDA, paid-up and not-yet-due ones do not', async () => {
    await seedWorld(admin, seed);
    await world.daily.execute();
    expect((await statuses()).invoices).toEqual({
      inv_a: 'VENCIDA',
      inv_b: 'VENCIDA',
      inv_ok: 'EMITIDA',
    });
  });

  it('HU-19 CA3: a document becomes VENCIDO the day after its expiry, not before', async () => {
    await seedWorld(admin, seed);
    world.clock.set('2026-10-28T15:00:00.000Z'); // the expiry day itself
    await world.daily.execute();
    expect((await statuses()).documents).toEqual({ doc_exp: 'FIRMADO', doc_later: 'FIRMADO' });

    world.clock.set('2026-10-29T15:00:00.000Z');
    await world.daily.execute();
    expect((await statuses()).documents).toEqual({ doc_exp: 'VENCIDO', doc_later: 'FIRMADO' });
  });

  it('HU-10 CA1-CA3: the period appears on the 29th, once, and a paused charge generates none', async () => {
    await seedWorld(admin, seed);
    await world.daily.execute(); // the 28th: too early
    expect(await periods('rec_0')).toEqual([]);

    world.clock.set('2026-10-29T15:00:00.000Z');
    await world.daily.execute();
    await world.daily.execute(); // CA2: the same day twice
    expect(await periods('rec_0')).toEqual(['2026-11-05']);
    expect(await periods('rec_1')).toEqual([]);
  });

  it('marks an expired link once; open and never-expiring links are untouched', async () => {
    await seedWorld(admin, seed);
    world.clock.set('2026-10-29T15:00:00.000Z');
    await world.daily.execute();
    const first = (await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_exp' } })).expiredAt;
    expect(first).not.toBeNull();
    expect(await admin.shareLink.count({ where: { expiredAt: { not: null } } })).toBe(1);
    expect(
      await admin.activityLog.count({ where: { action: 'SYSTEM_JOB', entityType: 'SHARE_LINK' } }),
    ).toBe(1);

    world.clock.set('2026-10-30T15:00:00.000Z');
    await world.daily.execute();
    expect(
      (await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_exp' } })).expiredAt,
    ).toEqual(first);
  });

  it('a rerun changes nothing and adds only the five summary entries (A4)', async () => {
    await seedWorld(admin, seed);
    world.clock.set('2026-10-29T15:00:00.000Z');
    await world.daily.execute();
    const summaries = await SYSTEM_JOB_SUMMARIES(admin);
    expect(summaries).toBe(5);
    const before = {
      state: await statuses(),
      installments: await admin.billingInstallment.count(),
      expenses: await admin.expense.count(),
      activity: await admin.activityLog.count(),
      metrics: await metrics(),
    };

    await world.daily.execute();

    expect({
      state: await statuses(),
      installments: await admin.billingInstallment.count(),
      expenses: await admin.expense.count(),
      activity: (await admin.activityLog.count()) - 5,
      metrics: await metrics(),
    }).toEqual(before);
    expect(await SYSTEM_JOB_SUMMARIES(admin)).toBe(10);
  });

  it('DT-165: after the job the metrics equal a from-scratch RecomputeAll on the same data', async () => {
    await seedWorld(admin, seed);
    world.clock.set('2026-10-29T15:00:00.000Z');
    await world.daily.execute();
    const afterJob = await metrics();
    expect(afterJob.clients.some((row) => Number(row.overdueUsd) > 0)).toBe(true);

    await world.recomputeAll.execute(SYSTEM_ACTOR);

    expect(await metrics()).toEqual(afterJob);
  });
});
