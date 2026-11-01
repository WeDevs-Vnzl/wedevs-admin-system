import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildPrismaWorld,
  ownerOf,
  seedClient,
  seedProject,
  type PrismaWorld,
} from './prisma-world';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
let world: PrismaWorld;
let owner: CurrentUser;

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(async () => {
  await truncateBusinessTables(admin);
  owner = await ownerOf(admin);
  world = buildPrismaWorld(service);
  await world.uow.run(async () => {
    await seedClient(world.host.db, 'cli_a');
    await seedClient(world.host.db, 'cli_b');
    await seedProject(world.host.db, 'pry_a', ['cli_a', 'cli_b']);
  });
  await admin.exchangeRate.create({
    data: { date: new Date('2026-10-09'), currency: 'EUR', usdRate: '0.9', source: 'BCV' },
  });
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

/** Everything billing writes that a full recompute rebuilds. */
async function readModels() {
  const [metrics, clients, installments, charges, activity] = await Promise.all([
    admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } }),
    admin.clientMetrics.findMany({ orderBy: { clientId: 'asc' } }),
    admin.billingInstallment.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    }),
    admin.recurringCharge.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, monthlyAmountUsd: true },
    }),
    admin.activityLog.findMany({ select: { entityType: true, clientId: true } }),
  ]);
  return {
    metrics: JSON.stringify({ ...metrics, updatedAt: null }),
    clients: JSON.stringify(
      clients.map((row) => ({ ...row, lastActivityAt: null, updatedAt: null })),
    ),
    installments,
    charges: charges.map((row) => ({
      id: row.id,
      monthlyAmountUsd: row.monthlyAmountUsd.toFixed(2),
    })),
    activity,
  };
}

async function expectEqualToRecompute() {
  const before = await readModels();
  const result = await world.recomputeAll.execute(SYSTEM_ACTOR);
  expect(result.problems).toEqual([]);
  const after = await readModels();
  expect(after.metrics).toBe(before.metrics);
  expect(after.clients).toBe(before.clients);
  expect(after.installments).toEqual(before.installments);
  expect(after.charges).toEqual(before.charges);
}

describe('the read models after each billing mutation equal a full recompute-all', () => {
  it('plan, adjustments, recurring charges, status changes and cancellation', async () => {
    await world.upsertPlan.execute(owner, {
      projectId: 'pry_a',
      model: 'MIXTO',
      currency: 'EUR',
      contractAmount: '1000',
    });
    await expectEqualToRecompute();
    const metrics = await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } });
    // D1: 1000 EUR at 0.9 = 1111.11 USD, kept even though the rate moves afterwards.
    expect(metrics.contractedUsd.toFixed(2)).toBe('1111.11');

    await admin.exchangeRate.create({
      data: { date: new Date('2026-10-09'), currency: 'EUR', usdRate: '0.5', source: 'MANUAL' },
    });
    await world.applyTemplate.execute(owner, { projectId: 'pry_a', template: 'SPLIT_50_50' });
    await expectEqualToRecompute();

    const adjusted = await world.createInstallment.execute(owner, {
      projectId: 'pry_a',
      kind: 'AJUSTE',
      label: 'Alcance',
      amount: '-100',
      currency: 'EUR',
    });
    await expectEqualToRecompute();
    expect(
      (
        await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } })
      ).contractedUsd.toFixed(2),
    ).toBe('1000.00');

    const adjustId = adjusted.installments.find((item) => item.kind === 'AJUSTE')?.id as string;
    await world.updateInstallment.execute(owner, { id: adjustId, amount: '-200' });
    await expectEqualToRecompute();
    await world.cancelInstallment.execute(owner, adjustId);
    await expectEqualToRecompute();

    const charged = await world.createCharge.execute(owner, {
      projectId: 'pry_a',
      label: 'Soporte',
      amount: '300',
      currency: 'EUR',
      frequency: 'TRIMESTRAL',
      startDate: '2026-11-01',
      billingDay: 5,
      leadDays: 7,
    });
    await expectEqualToRecompute();
    const chargeId = charged.recurringCharges[0]?.id as string;
    expect(
      (
        await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } })
      ).monthlyRecurringUsd.toFixed(2),
    ).toBe('111.11');

    await world.updateCharge.execute(owner, {
      id: chargeId,
      label: 'Soporte',
      amount: '600',
      currency: 'EUR',
      frequency: 'TRIMESTRAL',
      startDate: '2026-11-01',
      billingDay: 5,
      leadDays: 7,
    });
    await expectEqualToRecompute();
    await world.setChargeStatus.execute(owner, { id: chargeId, status: 'PAUSADO' });
    await expectEqualToRecompute();
    expect(
      (
        await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } })
      ).monthlyRecurringUsd.toFixed(2),
    ).toBe('0.00');
    await world.setChargeStatus.execute(owner, { id: chargeId, status: 'ACTIVO' });
    await world.generateMissing.execute(owner, { recurringChargeId: chargeId, upTo: '2026-12-31' });
    await expectEqualToRecompute();
  });

  it('cancelForProject finishes the charges and cancels the pending installments in the caller unit of work', async () => {
    await world.upsertPlan.execute(owner, {
      projectId: 'pry_a',
      model: 'MIXTO',
      currency: 'USD',
      contractAmount: '1000',
    });
    await world.applyTemplate.execute(owner, { projectId: 'pry_a', template: 'SPLIT_50_50' });
    await world.createCharge.execute(owner, {
      projectId: 'pry_a',
      label: 'Soporte',
      amount: '100',
      currency: 'USD',
      frequency: 'MENSUAL',
      startDate: '2026-11-01',
      billingDay: 5,
      leadDays: 7,
    });
    const lockSet = await world.projectApi.lockSet('pry_a');
    const result = await world.uow.run(
      async () => {
        await world.locks.lock({ Project: ['pry_a'], Client: ['cli_a', 'cli_b'], ...lockSet });
        return world.projectApi.cancelForProject('pry_a', {
          cancelPendingInstallments: true,
          finishRecurringCharges: true,
        });
      },
      { isolation: 'Serializable' },
    );
    expect(result).toEqual({ installments: 2, recurringCharges: 1 });
    expect(await world.projectApi.hasActiveBilling('pry_a')).toBe(false);
    await expectEqualToRecompute();
    expect(
      (
        await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } })
      ).monthlyRecurringUsd.toFixed(2),
    ).toBe('0.00');
  });

  it('records the activity with the client scope of the project', async () => {
    await world.upsertPlan.execute(owner, {
      projectId: 'pry_a',
      model: 'PRECIO_FIJO',
      currency: 'USD',
      contractAmount: '10',
    });
    const entry = await admin.activityLog.findFirstOrThrow({
      where: { entityType: 'BILLING_PLAN' },
    });
    expect(entry).toMatchObject({
      action: 'CREATE',
      actorType: 'USER',
      actorId: owner.userId,
      clientId: 'cli_a',
    });
    const touched = await admin.clientMetrics.findMany({
      where: { lastActivityAt: { not: null } },
    });
    expect(touched.map((row) => row.clientId).sort()).toEqual(['cli_a', 'cli_b']);
  });
});
