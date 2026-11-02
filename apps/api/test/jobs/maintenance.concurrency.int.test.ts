import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GenerateRecurringInstallments } from '../../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { GenerateRecurringExpenses } from '../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkOverdueInvoices } from '../../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { MarkExpiredDocuments } from '../../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { MarkExpiredShareLinks } from '../../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { DailyMaintenance } from '../../src/modules/jobs/application/daily-maintenance';
import { JobRunner } from '../../src/modules/jobs/application/job-runner';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { buildWorld } from '../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { seedWorld } from './seed';
import { bootJobsWorld, SYSTEM_JOB_SUMMARIES, type JobsWorld } from './world';

/**
 * Two `DailyMaintenance` runs truly overlapping on a real database (the queue never does this on purpose, but a
 * stalled job re-run or a second worker can). `Rendezvous` holds each run at the start of a step until the other
 * run has arrived, so both execute the same step at the same moment instead of one after the other. Guarantees
 * (A4): no duplicate installment or recurring expense period, no invoice, document or link transitioned twice,
 * and one per-row entry per processed record plus the five step summaries each run owns.
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

/** Releases its waiters once `parties` of them arrived: the two runs enter the step together. */
class Rendezvous {
  private waiting: (() => void)[] = [];
  constructor(private readonly parties: number) {}
  async arrive(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      if (this.waiting.length === this.parties) {
        const release = this.waiting;
        this.waiting = [];
        for (const go of release) go();
      }
    });
  }
}

/** The step's `execute` waits at `point` before it runs. */
function overlapped<T extends { execute(...args: never[]): Promise<unknown> }>(
  step: T,
  point: Rendezvous,
): T {
  return new Proxy(step, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop !== 'execute') return typeof value === 'function' ? value.bind(target) : value;
      return async (...args: never[]) => {
        await point.arrive();
        return target.execute(...args);
      };
    },
  });
}

function steps(points?: Record<string, Rendezvous>) {
  const wrap = <T extends { execute(...args: never[]): Promise<unknown> }>(
    name: string,
    step: T,
  ) => (points?.[name] ? overlapped(step, points[name]) : step);
  return {
    markOverdueInvoices: wrap('overdue', get(MarkOverdueInvoices)),
    markExpiredDocuments: wrap('documents', get(MarkExpiredDocuments)),
    generateRecurringInstallments: wrap('installments', get(GenerateRecurringInstallments)),
    generateRecurringExpenses: wrap('expenses', get(GenerateRecurringExpenses)),
    markExpiredShareLinks: wrap('links', get(MarkExpiredShareLinks)),
  };
}
const dailyOf = (s = steps()) => new DailyMaintenance(get(JobRunner), s);
const pointsFor = (...names: string[]) =>
  Object.fromEntries(names.map((name) => [name, new Rendezvous(2)]));

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
  const ALL = ['overdue', 'documents', 'installments', 'expenses', 'links'] as const;

  it('enter every step together and neither fails nor duplicates anything', async () => {
    const points = pointsFor(...ALL);
    const outcomes = await Promise.allSettled([
      dailyOf(steps(points)).execute(),
      dailyOf(steps(points)).execute(),
    ]);

    // A run that lost a serialization race skips that row (a conflict), it never fails the step.
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled']);
    await expectNoDuplicates(10);
  });

  it.each(ALL)('hold both runs at the %s step only and release them together', async (name) => {
    const points = pointsFor(name);
    const outcomes = await Promise.allSettled([
      dailyOf(steps(points)).execute(),
      dailyOf(steps(points)).execute(),
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled']);
    await expectNoDuplicates(10);
  });
});
