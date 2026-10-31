import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { seedInvoice } from '../read-models/world';
import {
  buildPrismaWorld,
  Gate,
  gated,
  interleave,
  ownerOf,
  seedClient,
  seedProject,
  type PrismaWorld,
  type PrismaWorldHooks,
} from './prisma-world';

/**
 * Two truly concurrent transactions over real PostgreSQL (lessons B3, M1, M2; Q-BE3-1). The first one is
 * paused (`Gate`) holding its rows; the second one then runs and must wait on them (read from
 * `pg_stat_activity`, no sleeps as ordering). Each scenario repeats.
 */
const ROUNDS = 3;
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

let owner: CurrentUser;

async function setup(): Promise<PrismaWorld> {
  await truncateBusinessTables(admin);
  owner = await ownerOf(admin);
  const world = buildPrismaWorld(service);
  await world.uow.run(async () => {
    await seedClient(world.host.db, 'cli_a');
    await seedProject(world.host.db, 'pry_a', ['cli_a']);
  });
  return world;
}

const plan = (over: object = {}) => ({
  projectId: 'pry_a',
  model: 'PRECIO_FIJO' as const,
  currency: 'USD',
  contractAmount: '10000',
  ...over,
});

/** What the invoices package does: lock the installment, bill it, recompute its status, commit. */
function billing(world: PrismaWorld, installmentId: string, gate: Gate) {
  return () =>
    world.uow.run(
      async () => {
        await world.locks.lock({ BillingInstallment: [installmentId] });
        await seedInvoice(world.host.db, {
          id: 'inv_a',
          clientId: 'cli_a',
          lines: [
            { id: 'inl_a', projectId: 'pry_a', unitPrice: '4000.00', ivaRate: null, installmentId },
          ],
        });
        await world.repository.setInstallmentStatus(installmentId, 'FACTURADA');
        await gate.pause();
      },
      { isolation: 'Serializable' },
    );
}

async function billedScenario(
  round: number,
  second: (world: PrismaWorld, id: string) => Promise<unknown>,
) {
  const first = await setup();
  await first.upsertPlan.execute(owner, plan());
  const page = await first.createInstallment.execute(owner, {
    projectId: 'pry_a',
    kind: 'ANTICIPO',
    label: `A${round}`,
    amount: '4000',
    currency: 'USD',
  });
  const installmentId = page.installments[0]?.id as string;
  const gate = new Gate();
  const results = await interleave(
    admin,
    gate,
    billing(buildPrismaWorld(service), installmentId, gate),
    () => second(buildPrismaWorld(service), installmentId),
  );
  return { results, installmentId };
}

describe('an invoice line and an installment edit that run together', () => {
  it('the edit waits for the billing lock, then is refused: the billed amount never changes', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { results, installmentId } = await billedScenario(round, (world, id) =>
        world.updateInstallment.execute(owner, { id, amount: '4500' }),
      );
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: { code: 'INTEGRITY_LOCK' },
      });
      const row = await admin.billingInstallment.findUniqueOrThrow({
        where: { id: installmentId },
      });
      expect(row.amount.toFixed(2)).toBe('4000.00');
      expect(row.status).toBe('FACTURADA');
    }
  });

  it('cancelling waits for the billing lock, then is refused', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { results, installmentId } = await billedScenario(round, (world, id) =>
        world.cancelInstallment.execute(owner, id),
      );
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'INTEGRITY_LOCK' } });
      const row = await admin.billingInstallment.findUniqueOrThrow({
        where: { id: installmentId },
      });
      expect(row.cancelledAt).toBeNull();
    }
  });

  it('a plan currency change waits for the billing lock, then is refused', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { results } = await billedScenario(round, async (world) => {
        await admin.exchangeRate.create({
          data: { date: new Date('2026-10-09'), currency: 'EUR', usdRate: '0.9', source: 'BCV' },
        });
        return world.upsertPlan.execute(owner, plan({ currency: 'EUR', contractAmount: '1000' }));
      });
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: { code: 'INTEGRITY_LOCK', message: 'billing.errors.currencyLocked' },
      });
      const stored = await admin.billingPlan.findUniqueOrThrow({ where: { projectId: 'pry_a' } });
      expect(stored.currency).toBe('USD');
    }
  });
});

describe('the recurring generation that runs twice at once', () => {
  async function chargeScenario(hooks: PrismaWorldHooks) {
    const world = await setup();
    await world.upsertPlan.execute(owner, plan());
    const page = await world.createCharge.execute(owner, {
      projectId: 'pry_a',
      label: 'Soporte',
      amount: '100',
      currency: 'USD',
      frequency: 'MENSUAL',
      startDate: '2026-11-01',
      billingDay: 5,
      leadDays: 7,
    });
    const chargeId = page.recurringCharges[0]?.id as string;
    // 2026-10-29 is the day the first period (2026-11-05) is due.
    const clock = { now: () => new Date('2026-10-29T15:00:00.000Z') };
    const gate = new Gate();
    const slow = buildPrismaWorld(service, {
      ...hooks,
      clock,
      repository: (repository) => {
        const decorated = hooks.repository ? hooks.repository(repository) : repository;
        return gated(decorated, gate, ['insertGeneratedInstallments'], 'after');
      },
    });
    const fast = buildPrismaWorld(service, { ...hooks, clock });
    const results = await interleave(
      admin,
      gate,
      () => slow.runGeneration.execute(SYSTEM_ACTOR),
      () => fast.runGeneration.execute(SYSTEM_ACTOR),
    );
    return { results, chargeId };
  }

  it('creates one installment per period and reports it once', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { results, chargeId } = await chargeScenario({});
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const created = results.flatMap((result) =>
        result.status === 'fulfilled' ? (result.value as { created: number }).created : [],
      );
      expect(created.reduce((sum, count) => sum + count, 0)).toBe(1);
      const rows = await admin.billingInstallment.findMany({
        where: { recurringChargeId: chargeId },
      });
      expect(rows.map((row) => row.periodStart?.toISOString().slice(0, 10))).toEqual([
        '2026-11-05',
      ]);
      expect(await admin.activityLog.count({ where: { action: 'SYSTEM_JOB' } })).toBe(1);
    }
  });

  it('a duplicate period is skipped by the insert even when nobody holds the locks', async () => {
    const { results, chargeId } = await chargeScenario({
      locks: () => ({ lock: async () => undefined }),
    });
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await admin.billingInstallment.count({ where: { recurringChargeId: chargeId } })).toBe(
      1,
    );
  });
});
