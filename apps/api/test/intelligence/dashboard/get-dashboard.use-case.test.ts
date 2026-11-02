import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationFailedError } from '../../../src/shared/domain/domain-error';
import type { EntityRef } from '../../../src/shared/domain/entity-ref';
import { buildDashboardWorld, NOW, userOf, type DashboardWorld } from './dashboard-world';

const ref = (type: EntityRef['type'], id: string, label = id): EntityRef => ({
  type,
  id,
  code: id.toUpperCase(),
  label,
});

/**
 * Hand-computed fixture, today 2026-01-15:
 *   Nov 2025  inv2 billed 300.00 (due 2025-12-20), collected 100.00, expenses 50.00
 *   Dec 2025  inv1 billed 500.00 (due 2026-01-05), collected 200.00, expenses 70.00
 *   Jan 2026  inv3 billed 900.00 (due 2026-02-15), collected 400.00, expenses 120.00
 *   Jun 2025  collected 1000.00, billed 2000.00, expenses 500.00 (no invoice)
 */
function seed(world: DashboardWorld): void {
  const f = world.facts;
  const inv = (invoiceId: string, clientId: string, dueDate: string) => ({
    invoiceId,
    clientId,
    dueDate,
  });
  f.addFact({
    kind: 'BILLED',
    date: '2025-11-20',
    amountUsd: '300.00',
    ...inv('inv2', 'c1', '2025-12-20'),
  });
  f.addFact({
    kind: 'COLLECTED',
    date: '2025-11-25',
    amountUsd: '100.00',
    ...inv('inv2', 'c1', '2025-12-20'),
  });
  f.addFact({ kind: 'EXPENSE_PAID', date: '2025-11-02', amountUsd: '50.00' });
  f.addFact({
    kind: 'BILLED',
    date: '2025-12-01',
    amountUsd: '500.00',
    ...inv('inv1', 'c1', '2026-01-05'),
  });
  f.addFact({
    kind: 'COLLECTED',
    date: '2025-12-05',
    amountUsd: '200.00',
    ...inv('inv1', 'c1', '2026-01-05'),
  });
  f.addFact({ kind: 'EXPENSE_PAID', date: '2025-12-20', amountUsd: '70.00' });
  f.addFact({
    kind: 'BILLED',
    date: '2026-01-03',
    amountUsd: '900.00',
    ...inv('inv3', 'c2', '2026-02-15'),
  });
  f.addFact({
    kind: 'COLLECTED',
    date: '2026-01-05',
    amountUsd: '400.00',
    ...inv('inv3', 'c2', '2026-02-15'),
  });
  f.addFact({ kind: 'EXPENSE_PAID', date: '2026-01-08', amountUsd: '120.00' });
  f.addFact({ kind: 'COLLECTED', date: '2025-06-15', amountUsd: '1000.00' });
  f.addFact({ kind: 'BILLED', date: '2025-06-15', amountUsd: '2000.00' });
  f.addFact({ kind: 'EXPENSE_PAID', date: '2025-06-20', amountUsd: '500.00' });

  world.panels.charges = [
    { monthlyAmountUsd: '100.00', status: 'ACTIVO', startDate: '2025-06-01' },
    { monthlyAmountUsd: '50.00', status: 'ACTIVO', startDate: '2026-01-10' },
    { monthlyAmountUsd: '30.00', status: 'ACTIVO', startDate: '2025-01-01', endDate: '2025-12-20' },
    { monthlyAmountUsd: '20.00', status: 'PAUSADO', startDate: '2025-01-01' },
  ];
  world.panels.accounts = [
    { currency: 'USD', balance: '1000.00' },
    { currency: 'VES', balance: '3650.00' },
    { currency: 'EUR', balance: '999.00' }, // no rate: left out, never guessed
  ];
  world.metrics.addProject({ id: 'p1', name: 'A', status: 'EN_CURSO' });
  world.metrics.addProject({ id: 'p2', name: 'B', status: 'EN_CURSO' });
  world.metrics.addProject({ id: 'p3', name: 'C', status: 'MANTENIMIENTO' });
  world.metrics.addProject({ id: 'p4', name: 'D', status: 'ENTREGADO' });
  world.metrics.addProject({ id: 'p5', name: 'E', status: 'EN_CURSO', archived: true });
}

type Cards = Record<
  string,
  [value: string, previous: string | null, change: string | null, secondary: string | null]
>;
const cardsOf = (
  kpis: {
    id: string;
    value: string;
    previousValue: string | null;
    changePercent: string | null;
    secondaryValue: string | null;
  }[],
): Cards =>
  Object.fromEntries(
    kpis.map((k) => [k.id, [k.value, k.previousValue, k.changePercent, k.secondaryValue]]),
  );

describe('GetDashboard', () => {
  let world: DashboardWorld;
  const owner = userOf('OWNER');

  beforeEach(() => {
    world = buildDashboardWorld();
    seed(world);
  });

  it('defaults to the current business month and sums the flows of that month (DT-98)', async () => {
    const out = await world.dashboard.execute(owner, {});
    expect(out).toMatchObject({
      month: '2026-01',
      period: 'month',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
      currency: 'USD',
    });
    expect(out.kpis.map((k) => k.id)).toEqual([
      'COLLECTED_MONTH',
      'BILLED_MONTH',
      'RECEIVABLE',
      'EXPENSES_MONTH',
      'RESULT_MONTH',
      'ACCOUNTS_BALANCE',
      'MRR',
      'ACTIVE_PROJECTS',
    ]);
    expect(out.kpis.find((k) => k.id === 'ACTIVE_PROJECTS')?.unit).toBe('COUNT');
    expect(cardsOf(out.kpis)).toEqual({
      COLLECTED_MONTH: ['400.00', '200.00', '100.00', null],
      BILLED_MONTH: ['900.00', '500.00', '80.00', null],
      // receivable at today against the previous month's close; the overdue part apart
      RECEIVABLE: ['1000.00', '500.00', '100.00', '500.00'],
      EXPENSES_MONTH: ['120.00', '70.00', '71.43', null],
      RESULT_MONTH: ['280.00', '130.00', '115.38', null],
      // current balance at the latest rate: 1000 + 3650 / 36.5, the EUR account has no rate
      ACCOUNTS_BALANCE: ['1100.00', null, null, null],
      // started 2026-01-10 is in today's MRR but not in the previous close's
      MRR: ['150.00', '100.00', '50.00', null],
      ACTIVE_PROJECTS: ['3', null, null, null],
    });
  });

  it('a running quarter sums its flows to date and compares with the previous quarter (January)', async () => {
    const out = await world.dashboard.execute(owner, { period: 'quarter' });
    expect(out).toMatchObject({
      month: '2026-01',
      period: 'quarter',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
    });
    expect(cardsOf(out.kpis)).toEqual({
      COLLECTED_MONTH: ['400.00', '300.00', '33.33', null],
      BILLED_MONTH: ['900.00', '800.00', '12.50', null],
      RECEIVABLE: ['1000.00', '500.00', '100.00', '500.00'],
      EXPENSES_MONTH: ['120.00', '120.00', '0.00', null],
      RESULT_MONTH: ['280.00', '180.00', '55.56', null],
      ACCOUNTS_BALANCE: ['1100.00', null, null, null],
      // MRR stays monthly under any period (DT-173)
      MRR: ['150.00', '100.00', '50.00', null],
      ACTIVE_PROJECTS: ['3', null, null, null],
    });
  });

  it('a running year compares with the previous year', async () => {
    const out = await world.dashboard.execute(owner, { period: 'year', month: '2026-01' });
    expect(out).toMatchObject({ periodStart: '2026-01-01', periodEnd: '2026-12-31' });
    expect(cardsOf(out.kpis)).toMatchObject({
      COLLECTED_MONTH: ['400.00', '1300.00', '-69.23', null],
      BILLED_MONTH: ['900.00', '2800.00', '-67.86', null],
      EXPENSES_MONTH: ['120.00', '620.00', '-80.65', null],
      RESULT_MONTH: ['280.00', '680.00', '-58.82', null],
      RECEIVABLE: ['1000.00', '500.00', '100.00', '500.00'],
    });
  });

  it('an anchor in a later month of the running quarter stays valid, closing today', async () => {
    const later = await world.dashboard.execute(owner, { period: 'quarter', month: '2026-03' });
    const current = await world.dashboard.execute(owner, { period: 'quarter' });
    expect(later.kpis).toEqual(current.kpis);
    expect(later).toMatchObject({ month: '2026-03', periodStart: '2026-01-01' });
  });

  it('a past month closes on its last day and compares with the month before its own close', async () => {
    const out = await world.dashboard.execute(owner, { month: '2025-12' });
    expect(cardsOf(out.kpis)).toMatchObject({
      COLLECTED_MONTH: ['200.00', '100.00', '100.00', null],
      BILLED_MONTH: ['500.00', '300.00', '66.67', null],
      // inv1 300 (not yet due) + inv2 200 (overdue) at 12-31; inv2 200 at 11-30
      RECEIVABLE: ['500.00', '200.00', '150.00', '200.00'],
      EXPENSES_MONTH: ['70.00', '50.00', '40.00', null],
      RESULT_MONTH: ['130.00', '50.00', '160.00', null],
      MRR: ['100.00', '130.00', '-23.08', null],
      // no status history: the current count, without comparison, also for a past month (A12)
      ACTIVE_PROJECTS: ['3', null, null, null],
    });
  });

  it('shows twelve months ending at the month of the close, empty months as zeros (A14)', async () => {
    const out = await world.dashboard.execute(owner, { period: 'year' });
    expect(out.incomeVsExpenses.periods).toEqual([
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
    ]);
    const z = '0.00';
    expect(out.incomeVsExpenses.series).toEqual([
      { id: 'income', values: [z, z, z, z, '1000.00', z, z, z, z, '100.00', '200.00', '400.00'] },
      { id: 'expenses', values: [z, z, z, z, '500.00', z, z, z, z, '50.00', '70.00', '120.00'] },
    ]);
    const past = await world.dashboard.execute(owner, { period: 'quarter', month: '2025-11' });
    expect(past.incomeVsExpenses.periods.at(-1)).toBe('2025-12');
  });

  it('answers VALIDATION before any read when the period starts after today', async () => {
    const sum = vi.spyOn(world.facts, 'sumByKind');
    for (const input of [
      { month: '2026-02' },
      { period: 'quarter', month: '2026-04' },
      { period: 'year', month: '2027-01' },
    ]) {
      await expect(world.dashboard.execute(owner, input)).rejects.toBeInstanceOf(
        ValidationFailedError,
      );
    }
    expect(sum).not.toHaveBeenCalled();
    expect(world.panels.reads).toBe(0);
  });

  it('rejects an unknown period and a malformed month without the DTO', async () => {
    for (const input of [{ period: 'week' }, { month: '2026-13' }, { month: 'x' }]) {
      await expect(world.dashboard.execute(owner, input)).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
  });

  it('lists the five panels within §8.1 limits, relative to today', async () => {
    const p = world.panels;
    p.invoices = Array.from({ length: 6 }, (_, i) => ({
      invoice: ref('INVOICE', `i${i}`),
      client: ref('CLIENT', 'c1'),
      dueDate: i === 0 ? '2026-01-10' : `2026-02-0${i}`,
      currency: 'USD',
      balance: '10.00',
      balanceUsd: '10.00',
    }));
    p.installments = [
      {
        installment: ref('INSTALLMENT', 'n1'),
        project: ref('PROJECT', 'p1'),
        amount: '50.00',
        currency: 'USD',
        dueDate: '2026-02-14',
      },
      {
        installment: ref('INSTALLMENT', 'n2'),
        project: ref('PROJECT', 'p1'),
        amount: '50.00',
        currency: 'USD',
        dueDate: '2026-02-15',
      },
    ];
    p.documents = [
      { document: ref('DOCUMENT', 'd1'), expiresAt: '2026-01-20' },
      { document: ref('DOCUMENT', 'd2'), expiresAt: '2026-02-15' },
    ];
    p.recurringExpenses = [
      {
        expense: ref('EXPENSE', 'e1'),
        dueDate: '2026-01-30',
        amount: '40.00',
        currency: 'USD',
        amountUsd: '40.00',
      },
      {
        expense: ref('EXPENSE', 'e2'),
        dueDate: '2026-02-20',
        amount: '40.00',
        currency: 'USD',
        amountUsd: '40.00',
      },
    ];
    p.activity = Array.from({ length: 16 }, (_, i) => ({
      id: `a${String(i).padStart(2, '0')}`,
      action: 'UPDATE' as const,
      entity: ref('CLIENT', 'c1'),
      actorName: 'Ana',
      createdAt: new Date(Date.parse(NOW) - i * 1000),
    }));

    const out = await world.dashboard.execute(owner, {});
    expect(out.invoicesDue).toHaveLength(5);
    expect(out.invoicesDue[0]).toMatchObject({ dueDate: '2026-01-10', daysUntilDue: -5 });
    expect(out.invoicesDue[1]?.daysUntilDue).toBe(17);
    expect(out.installmentsToInvoice.map((r) => r.installment.id)).toEqual(['n1']);
    expect(out.documentsExpiring).toEqual([
      { document: ref('DOCUMENT', 'd1'), expiresAt: '2026-01-20', daysLeft: 5 },
    ]);
    expect(out.upcomingRecurringExpenses.map((r) => r.expense.id)).toEqual(['e1']);
    expect(out.recentActivity).toHaveLength(15);
    expect(out.recentActivity[0]?.id).toBe('a00');
  });

  it.each(['MEMBER', 'VIEWER'] as const)(
    '%s gets zeroed cards, no comparison, empty financial panels and no financial read (DT-175)',
    async (role) => {
      const sum = vi.spyOn(world.facts, 'sumByKind');
      const receivable = vi.spyOn(world.facts, 'receivableAt');
      world.panels.invoices = [
        {
          invoice: ref('INVOICE', 'i1'),
          client: ref('CLIENT', 'c1'),
          dueDate: '2026-01-10',
          currency: 'USD',
          balance: '10.00',
          balanceUsd: '10.00',
        },
      ];
      world.panels.documents = [{ document: ref('DOCUMENT', 'd1'), expiresAt: '2026-01-20' }];
      world.panels.activity = [
        { id: 'a1', action: 'UPDATE', entity: null, actorName: null, createdAt: new Date(NOW) },
      ];
      const out = await world.dashboard.execute(userOf(role), {});
      const z: Cards[string] = ['0.00', null, null, null];
      expect(cardsOf(out.kpis)).toEqual({
        COLLECTED_MONTH: z,
        BILLED_MONTH: z,
        RECEIVABLE: z,
        EXPENSES_MONTH: z,
        RESULT_MONTH: z,
        ACCOUNTS_BALANCE: z,
        MRR: z,
        ACTIVE_PROJECTS: ['3', null, null, null],
      });
      expect(out.incomeVsExpenses.series.every((s) => s.values.every((v) => v === '0.00'))).toBe(
        true,
      );
      expect(out.incomeVsExpenses.periods).toHaveLength(12);
      expect(out.invoicesDue).toEqual([]);
      expect(out.installmentsToInvoice).toEqual([]);
      expect(out.upcomingRecurringExpenses).toEqual([]);
      // documents follow `read document` (all roles); the activity log follows `read activity`
      expect(out.documentsExpiring).toHaveLength(1);
      expect(out.recentActivity).toEqual([]);
      expect(sum).not.toHaveBeenCalled();
      expect(receivable).not.toHaveBeenCalled();
    },
  );

  it('the recurring panel adds active schedules due in 30 days, valued at their own snapshot', async () => {
    world.panels.recurringExpenses = [
      {
        expense: ref('EXPENSE', 'e1'),
        dueDate: '2026-01-25',
        amount: '10.00',
        currency: 'USD',
        amountUsd: '10.00',
      },
    ];
    const schedule = (id: string, nextDueDate: string | null, amount = '50.00', usdRate = '1') => ({
      id,
      name: `Schedule ${id}`,
      nextDueDate,
      amount,
      currency: usdRate === '1' ? 'USD' : 'VES',
      usdRate,
    });
    world.recurring.rows = [
      schedule('r_soon', '2026-01-20'),
      schedule('r_ves', '2026-02-14', '360.00', '36'),
      schedule('r_past', '2026-01-14'),
      schedule('r_late', '2026-02-15'),
      schedule('r_none', null),
      ...Array.from({ length: 100 }, (_, i) => schedule(`r_pad${i}`, '2027-01-01')),
      schedule('r_page2', '2026-01-16'),
    ];
    const out = await world.dashboard.execute(owner, {});
    expect(out.upcomingRecurringExpenses).toEqual([
      {
        expense: { type: 'RECURRING_EXPENSE', id: 'r_page2', label: 'Schedule r_page2' },
        dueDate: '2026-01-16',
        amount: '50.00',
        currency: 'USD',
        amountUsd: '50.00',
      },
      {
        expense: { type: 'RECURRING_EXPENSE', id: 'r_soon', label: 'Schedule r_soon' },
        dueDate: '2026-01-20',
        amount: '50.00',
        currency: 'USD',
        amountUsd: '50.00',
      },
      expect.objectContaining({ expense: expect.objectContaining({ id: 'e1' }) }),
      {
        expense: { type: 'RECURRING_EXPENSE', id: 'r_ves', label: 'Schedule r_ves' },
        dueDate: '2026-02-14',
        amount: '360.00',
        currency: 'VES',
        amountUsd: '10.00',
      },
    ]);
    expect(world.recurring.queries.every((q) => q.filters.status === 'ACTIVO')).toBe(true);
  });

  it('a Member reads no schedule for the recurring panel', async () => {
    await world.dashboard.execute(userOf('MEMBER'), {});
    expect(world.recurring.queries).toEqual([]);
  });

  it('an Admin reads the activity log', async () => {
    world.panels.activity = [
      { id: 'a1', action: 'UPDATE', entity: null, actorName: 'Ana', createdAt: new Date(NOW) },
    ];
    const out = await world.dashboard.execute(userOf('ADMIN'), {});
    expect(out.recentActivity.map((r) => r.id)).toEqual(['a1']);
  });
});
