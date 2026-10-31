import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { GENERATION_ACTOR } from '../../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { Gate, gated, interleave } from '../concurrency/world';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedExpense,
  seedProject,
} from '../read-models/world';
import { buildExpenseWorld } from './int-world';

/**
 * Concurrent money mutations over real PostgreSQL (lessons B3, M1, M2; Q-BE3-1). The first transaction is
 * paused once it wrote its source row; the second one then runs. With the locks and `Serializable` the
 * second waits and reads the committed state; without them it works on a stale read and the two commits
 * disagree (double debit, a paid expense that was voided, a period created twice).
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let owner: CurrentUser;
let categoryId = '';

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_exp_conc', email: 'conc@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  const setup = buildExpenseWorld(service);
  await setup.uow.run(async () => {
    await seedClient(setup.host.db, 'cli_a');
    await seedProject(setup.host.db, 'pry_a', ['cli_a']);
    await seedAccount(setup.host.db, 'acc_usd', 'USD', '1200.00');
    categoryId = (await catalogIds(setup.host.db)).categoryId;
  });
}, 60_000);

const payment = (id: string) => ({
  id,
  accountId: 'acc_usd',
  paidAt: '2026-10-08',
  currency: 'USD',
  amount: '49.00',
  usdRate: '1',
});

async function seedPending(id: string): Promise<void> {
  const setup = buildExpenseWorld(service);
  await setup.uow.run(() =>
    seedExpense(setup.host.db, {
      id,
      categoryId,
      amount: '49.00',
      projectId: 'pry_a',
      status: 'PENDIENTE',
    }),
  );
}

const balance = async () =>
  (await admin.account.findUniqueOrThrow({ where: { id: 'acc_usd' } })).balance.toFixed(2);

/**
 * Two worlds, the first one paused once its source row is written (`pauseOn`): it then holds whatever the
 * use case locked, and the second one either waits for it (locks) or runs on a stale read (no locks).
 */
function twoWorlds(pauseOn: 'writer' | 'sequence' = 'writer') {
  const gate = new Gate();
  const slow = buildExpenseWorld(
    service,
    pauseOn === 'writer'
      ? { writer: (writer) => gated(writer, gate, ['replaceFacts'], 'before') }
      : { sequence: (sequence) => gated(sequence, gate, ['next'], 'before') },
  );
  const fast = buildExpenseWorld(service);
  return { gate, slow, fast };
}

describe('markExpensePaid twice', () => {
  it('leaves one CONFLICT and one debit', async () => {
    await seedPending('exp_a');
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.markPaid.execute(owner, payment('exp_a')),
      () => fast.markPaid.execute(owner, payment('exp_a')),
    );

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
    expect(await balance()).toBe('1151.00');
    expect(await admin.financeFact.count({ where: { kind: 'EXPENSE_PAID' } })).toBe(1);
    expect(await admin.activityLog.count({ where: { action: 'STATUS_CHANGE' } })).toBe(1);
    const metrics = await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } });
    expect(metrics.expensesUsd.toFixed(2)).toBe('49.00');
  });
});

describe('markExpensePaid vs voidExpense', () => {
  it('serialize: the void sees the committed payment and takes the debit back', async () => {
    await seedPending('exp_a');
    const { gate, slow, fast } = twoWorlds();

    const results = await interleave(
      admin,
      gate,
      () => slow.markPaid.execute(owner, payment('exp_a')),
      () => fast.voidExpense.execute(owner, { id: 'exp_a' }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const row = await admin.expense.findUniqueOrThrow({ where: { id: 'exp_a' } });
    expect(row.status).toBe('ANULADO');
    expect(await balance()).toBe('1200.00');
    expect(await admin.financeFact.count()).toBe(0);
    const metrics = await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } });
    expect(metrics.expensesUsd.toFixed(2)).toBe('0.00');
  });
});

describe('GenerateRecurringExpenses run twice', () => {
  it('creates one expense per period, never a duplicate', async () => {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - 1);
    await admin.recurringExpense.create({
      data: {
        id: 'rex_a',
        name: 'Hosting',
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
    const { gate, slow, fast } = twoWorlds('sequence');

    const results = await interleave(
      admin,
      gate,
      () => slow.generate.execute(GENERATION_ACTOR),
      () => fast.generate.execute(GENERATION_ACTOR),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const created = results.map(
      (result) => (result as PromiseFulfilledResult<{ created: number }>).value.created,
    );
    expect(created.reduce((sum, value) => sum + value, 0)).toBe(2);
    const rows = await admin.expense.findMany({ where: { recurringExpenseId: 'rex_a' } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.periodStart?.toISOString())).size).toBe(2);
    expect(rows.every((row) => row.status === 'PENDIENTE')).toBe(true);
  });
});
