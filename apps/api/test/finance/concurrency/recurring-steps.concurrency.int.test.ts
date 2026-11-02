import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { GENERATION_ACTOR } from '../../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import { ConflictError } from '../../../src/shared/domain/domain-error';
import { parseDateOnly, todayInCaracas } from '../../../src/shared/domain/business-date';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { buildPrismaWorld, ownerOf, seedClient, seedProject } from '../billing/prisma-world';
import { catalogIds } from '../read-models/world';
import { buildExpenseWorld } from '../expenses/int-world';

/**
 * A6 (BE-5, 4.3): a `ConflictError` on one charge or schedule leaves the daily step running. The step skips
 * the busy row, lists it in `skippedIds` and creates the rest; the next run picks the skipped row up.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('GenerateRecurringInstallments with a busy charge', () => {
  let owner: CurrentUser;
  const clock = { now: () => new Date('2026-10-29T15:00:00.000Z') };

  async function seedCharges(): Promise<{ busyId: string; otherId: string }> {
    owner = await ownerOf(admin);
    const world = buildPrismaWorld(service, { clock });
    await world.uow.run(async () => {
      await seedClient(world.host.db, 'cli_a');
      await seedClient(world.host.db, 'cli_b');
      await seedClient(world.host.db, 'cli_x');
      await seedProject(world.host.db, 'pry_a', ['cli_a']);
      await seedProject(world.host.db, 'pry_b', ['cli_b']);
    });
    const ids: string[] = [];
    for (const projectId of ['pry_a', 'pry_b']) {
      await world.upsertPlan.execute(owner, {
        projectId,
        model: 'PRECIO_FIJO',
        currency: 'USD',
        contractAmount: '10000',
      });
      const page = await world.createCharge.execute(owner, {
        projectId,
        label: `Soporte ${projectId}`,
        amount: '100',
        currency: 'USD',
        frequency: 'MENSUAL',
        startDate: '2026-11-01',
        billingDay: 5,
        leadDays: 7,
      });
      ids.push(page.recurringCharges[0]?.id as string);
    }
    return { busyId: ids[0] as string, otherId: ids[1] as string };
  }

  /** Another client joins the project between the step's first read and its lock: the plan went stale. */
  const staleOnce = (chargeId: string) => (locks: RowLocksPort) => {
    let done = false;
    return {
      lock: async (set: Parameters<RowLocksPort['lock']>[0]) => {
        if (!done && set.RecurringCharge?.includes(chargeId)) {
          done = true;
          await admin.projectClient.create({ data: { projectId: 'pry_a', clientId: 'cli_x' } });
        }
        return locks.lock(set);
      },
    };
  };

  it('skips the busy charge, creates the other one and picks the busy one up next run', async () => {
    const { busyId, otherId } = await seedCharges();
    const busyWorld = buildPrismaWorld(service, { clock, locks: staleOnce(busyId) });

    const first = await busyWorld.runGeneration.execute(SYSTEM_ACTOR);

    expect(first).toMatchObject({ created: 1, skippedIds: [busyId] });
    expect(await admin.billingInstallment.count({ where: { recurringChargeId: otherId } })).toBe(1);
    expect(await admin.billingInstallment.count({ where: { recurringChargeId: busyId } })).toBe(0);

    const second = await buildPrismaWorld(service, { clock }).runGeneration.execute(SYSTEM_ACTOR);

    expect(second).toMatchObject({ created: 1, skippedIds: [] });
    expect(await admin.billingInstallment.count({ where: { recurringChargeId: busyId } })).toBe(1);
  });
});

describe('GenerateRecurringExpenses with a busy schedule', () => {
  async function seedSchedules(): Promise<void> {
    await admin.user.create({
      data: { clerkId: 'user_rec', email: 'rec@example.test', name: 'Owner', role: 'OWNER' },
    });
    const setup = buildExpenseWorld(service);
    const { categoryId } = await setup.uow.run(() => catalogIds(setup.host.db));
    // The first of last month (Caracas): two periods are due.
    const start = parseDateOnly(`${todayInCaracas(new Date()).slice(0, 7)}-01`);
    start.setUTCMonth(start.getUTCMonth() - 1);
    for (const id of ['rex_a', 'rex_b']) {
      await admin.recurringExpense.create({
        data: {
          id,
          name: `Hosting ${id}`,
          categoryId,
          currency: 'USD',
          amount: '120.00',
          frequency: 'MENSUAL',
          dayOfPeriod: 1,
          leadDays: 0,
          startDate: start,
          usdRate: '1',
          monthlyAmountUsd: '120.00',
        },
      });
    }
  }

  /** The unit of work answers `CONFLICT` once its retries are exhausted; the lock call stands for it here. */
  const conflictOnce = (scheduleId: string) => (locks: RowLocksPort) => {
    let done = false;
    return {
      lock: async (set: Parameters<RowLocksPort['lock']>[0]) => {
        if (!done && set.RecurringExpense?.includes(scheduleId)) {
          done = true;
          throw new ConflictError();
        }
        return locks.lock(set);
      },
    };
  };

  it('skips the busy schedule, generates the other one and picks the busy one up next run', async () => {
    await seedSchedules();

    const first = await buildExpenseWorld(service, {
      locks: conflictOnce('rex_a'),
    }).generate.execute(GENERATION_ACTOR);

    expect(first).toMatchObject({ created: 2, skippedIds: ['rex_a'] });
    expect(await admin.expense.count({ where: { recurringExpenseId: 'rex_b' } })).toBe(2);
    expect(await admin.expense.count({ where: { recurringExpenseId: 'rex_a' } })).toBe(0);

    const second = await buildExpenseWorld(service).generate.execute(GENERATION_ACTOR);

    expect(second).toMatchObject({ created: 2, skippedIds: [] });
    expect(await admin.expense.count({ where: { recurringExpenseId: 'rex_a' } })).toBe(2);
  });
});
