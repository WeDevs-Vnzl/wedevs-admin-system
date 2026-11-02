import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenerateRecurringInstallments } from '../../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { GenerateRecurringExpenses } from '../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkOverdueInvoices } from '../../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { MarkExpiredDocuments } from '../../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { MarkExpiredShareLinks } from '../../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { DailyMaintenance } from '../../src/modules/jobs/application/daily-maintenance';
import { JobRunner } from '../../src/modules/jobs/application/job-runner';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { Gate, gated } from '../commercial/concurrency/world';
import { buildWorld } from '../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { seedWorld } from './seed';
import { bootJobsWorld, SYSTEM_JOB_SUMMARIES, type JobsWorld } from './world';

/**
 * Two `DailyMaintenance` runs overlapping (the queue never does this on purpose, but a stalled job re-run or a
 * second worker can): no duplicate period, no document, link or invoice processed twice, and no entry beyond
 * the five summaries each run owns (A4). The interleaving is forced through `Gate`, not timing.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const seed = buildWorld(service);
let world: JobsWorld;

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
  await seedWorld(admin, seed);
});

const get = <T>(token: new (...args: never[]) => T): T =>
  world.context.get(token, { strict: false });

function steps(
  hooks: {
    installments?: (step: GenerateRecurringInstallments) => GenerateRecurringInstallments;
  } = {},
) {
  return {
    markOverdueInvoices: get(MarkOverdueInvoices),
    markExpiredDocuments: get(MarkExpiredDocuments),
    generateRecurringInstallments: (hooks.installments ?? ((s) => s))(
      get(GenerateRecurringInstallments),
    ),
    generateRecurringExpenses: get(GenerateRecurringExpenses),
    markExpiredShareLinks: get(MarkExpiredShareLinks),
  };
}
const dailyOf = (s = steps()) => new DailyMaintenance(get(JobRunner), s);

async function expectNoDuplicates(summaries: number) {
  const periods = await admin.billingInstallment.findMany({
    where: { recurringChargeId: 'rec_0' },
  });
  expect(periods.map((p) => p.periodStart?.toISOString().slice(0, 10))).toEqual(['2026-11-05']);
  const expenses = await admin.expense.findMany({ where: { recurringExpenseId: 'rex_a' } });
  expect(new Set(expenses.map((e) => e.periodStart?.toISOString())).size).toBe(expenses.length);
  expect(expenses.length).toBeGreaterThan(0);
  // One per-row entry per processed record, whoever got there first.
  const perRow = (entityType: string) =>
    admin.activityLog.count({ where: { action: 'SYSTEM_JOB', entityType: entityType as never } });
  expect(await perRow('INVOICE')).toBe(2);
  expect(await perRow('DOCUMENT')).toBe(1);
  expect(await perRow('SHARE_LINK')).toBe(1);
  expect(await perRow('RECURRING_CHARGE')).toBe(1);
  expect(await perRow('RECURRING_EXPENSE')).toBe(1);
  expect(await SYSTEM_JOB_SUMMARIES(admin)).toBe(summaries);
  const state = await admin.invoice.findMany({
    select: { id: true, status: true },
    orderBy: { id: 'asc' },
  });
  expect(state.filter((i) => i.status === 'VENCIDA').map((i) => i.id)).toEqual(['inv_a', 'inv_b']);
}

describe('two overlapping DailyMaintenance runs', () => {
  it('the second run completes inside the first, between two of its steps', async () => {
    const gate = new Gate();
    const first = dailyOf(steps({ installments: (s) => gated(s, gate, ['execute'], 'before') }));
    const second = dailyOf();

    const running = first.execute();
    await gate.arrived; // the first run finished the overdue and document steps and waits
    await second.execute();
    gate.release();
    await running;

    await expectNoDuplicates(10);
  });

  it('the first run waits after the installments step while the second runs entirely', async () => {
    const gate = new Gate();
    const first = dailyOf(steps({ installments: (s) => gated(s, gate, ['execute'], 'after') }));
    const second = dailyOf();

    const running = first.execute();
    await gate.arrived; // installments committed by the first run
    await second.execute();
    gate.release();
    await running;

    await expectNoDuplicates(10);
  });

  it('two runs started together end without a duplicate', async () => {
    const outcomes = await Promise.allSettled([dailyOf().execute(), dailyOf().execute()]);

    expect(outcomes.some((o) => o.status === 'fulfilled')).toBe(true);
    // A run that lost a serialization race fails (and the queue retries it); the retry here:
    for (const outcome of outcomes) if (outcome.status === 'rejected') await dailyOf().execute();
    const summaries = await SYSTEM_JOB_SUMMARIES(admin);
    expect(summaries % 5).toBe(0);
    await expectNoDuplicates(summaries);
  });
});
