import { beforeEach, describe, expect, it } from 'vitest';
import type {
  KpiOutput,
  KpisOutput,
} from '../../../src/modules/intelligence/application/use-cases/reports/kpi-types';
import { KPI_ID_VALUES } from '../../../src/modules/intelligence/application/use-cases/reports/kpi-catalog';
import { buildReportsWorld, userOf } from './reports-world';

const owner = userOf('OWNER');

type World = ReturnType<typeof buildReportsWorld>;

/**
 * October 2026, today the 9th. Hand-computed figures (the comments give the arithmetic):
 * billed Oct 1,000 / Sep 500; collected Oct 250 / Sep 100; paid expenses Oct 50, Sep 20, Aug 30, Jul 10.
 */
function seed(world: World): void {
  const { facts, inputs, rates } = world;
  const bill = (date: string, amountUsd: string, invoiceId: string, dueDate: string) =>
    facts.addFact({ kind: 'BILLED', date, amountUsd, clientId: 'cli_a', invoiceId, dueDate });
  bill('2026-10-01', '1000.00', 'inv_1', '2026-10-20');
  bill('2026-09-10', '500.00', 'inv_2', '2026-09-25');
  facts.addFact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '250.00', clientId: 'cli_a' });
  facts.addFact({ kind: 'COLLECTED', date: '2026-09-12', amountUsd: '100.00', clientId: 'cli_a' });
  for (const [date, amountUsd] of [
    ['2026-10-03', '50.00'],
    ['2026-09-05', '20.00'],
    ['2026-08-05', '30.00'],
    ['2026-07-05', '10.00'],
  ] as const) {
    facts.addFact({ kind: 'EXPENSE_PAID', date, amountUsd, projectId: 'pry_a' });
  }
  inputs.openInvoices = [
    { issueDate: '2026-09-10', dueDate: '2026-09-25', balanceUsd: '400.00' },
    { issueDate: '2026-10-01', dueDate: '2026-10-20', balanceUsd: '750.00' },
  ];
  inputs.charges = [
    { startDate: '2026-01-01', endDate: null, status: 'ACTIVO', monthlyAmountUsd: '100.00' },
    { startDate: '2026-10-05', endDate: null, status: 'ACTIVO', monthlyAmountUsd: '50.00' },
    { startDate: '2025-01-01', endDate: '2026-09-15', status: 'ACTIVO', monthlyAmountUsd: '70.00' },
    { startDate: '2026-01-01', endDate: null, status: 'PAUSADO', monthlyAmountUsd: '40.00' },
  ];
  inputs.recurringExpenseRows = [
    { status: 'ACTIVO', monthlyAmountUsd: '30.00' },
    { status: 'ACTIVO', monthlyAmountUsd: '12.50' },
    { status: 'PAUSADO', monthlyAmountUsd: '99.00' },
  ];
  inputs.balances = [
    { currency: 'USD', balance: '1000.00' },
    { currency: 'VES', balance: '3600.00' },
    { currency: 'EUR', balance: '10.00' },
  ];
  rates.byCurrency.set('VES', '36');
  inputs.collections = [
    { clientId: 'cli_b', date: '2026-09-20', amountUsd: '750.00' },
    { clientId: 'cli_a', date: '2026-10-02', amountUsd: '250.00' },
  ];
  inputs.labelRows.CLIENT.push(
    { id: 'cli_a', label: 'Kairos', code: 'CLI-1' },
    { id: 'cli_b', label: 'Zafiro', code: 'CLI-2' },
  );
  inputs.labelRows.PROJECT.push(
    { id: 'pry_a', label: 'Web', code: 'PRY-1' },
    { id: 'pry_b', label: 'App', code: 'PRY-2' },
  );
  inputs.labelRows.TECHNOLOGY.push(
    { id: 'tec_1', label: 'Next.js', code: null },
    { id: 'tec_2', label: 'Nest', code: null },
  );
  inputs.projectDays = [
    { projectId: 'pry_a', date: '2026-10-02', collectedUsd: '300.00', expensesUsd: '100.00' },
    { projectId: 'pry_b', date: '2026-10-03', collectedUsd: '100.00', expensesUsd: '0.00' },
    { projectId: 'pry_a', date: '2026-09-02', collectedUsd: '200.00', expensesUsd: '20.00' },
  ];
  const project = (
    id: string,
    status: 'EN_CURSO' | 'MANTENIMIENTO' | 'ENTREGADO',
    extra: Partial<World['inputs']['projects'][number]>,
  ) => ({
    id,
    status,
    startDate: '2026-08-01',
    targetEndDate: null,
    endDate: null,
    contractedUsd: null,
    technologyIds: [],
    hasSignedContract: false,
    ndaExpiries: [],
    ...extra,
  });
  inputs.projects = [
    project('pry_a', 'EN_CURSO', {
      startDate: '2026-10-02',
      contractedUsd: '3000.00',
      technologyIds: ['tec_1', 'tec_2'],
      hasSignedContract: true,
      ndaExpiries: [null],
    }),
    project('pry_b', 'MANTENIMIENTO', {
      startDate: '2026-09-10',
      contractedUsd: '1000.00',
      technologyIds: ['tec_1'],
      hasSignedContract: true,
      ndaExpiries: ['2026-10-01'],
    }),
    project('pry_x', 'ENTREGADO', {
      targetEndDate: '2026-10-10',
      endDate: '2026-10-05',
      technologyIds: ['tec_1'],
    }),
    project('pry_y', 'ENTREGADO', { targetEndDate: '2026-09-01', endDate: '2026-09-10' }),
  ];
  inputs.clients = [
    { id: 'a', createdAt: '2026-01-01', activatedAt: '2026-10-03' },
    { id: 'b', createdAt: '2026-09-01', activatedAt: '2026-09-15' },
    { id: 'c', createdAt: '2026-10-01', activatedAt: null },
    { id: 'd', createdAt: '2025-12-01', activatedAt: '2026-08-20' },
    { id: 'e', createdAt: '2026-10-02', activatedAt: '2026-10-04' },
  ];
}

describe('GetKpis: access and filters', () => {
  it.each(['MEMBER', 'VIEWER'] as const)(
    'is Owner and Admin only: %s gets FORBIDDEN',
    async (role) => {
      const world = buildReportsWorld();
      await expect(world.getKpis.execute(userOf(role), {})).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(world.inputs.totalCalls).toBe(0);
    },
  );

  it('rejects an inverted range, an unknown preset and a ghost id before reading any figure', async () => {
    const world = buildReportsWorld();
    await expect(
      world.getKpis.execute(owner, { preset: 'CUSTOM', from: '2026-10-05', to: '2026-09-01' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { to: ['reports.validation.rangeInverted'] },
    });
    await expect(world.getKpis.execute(owner, { preset: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(world.getKpis.execute(owner, { projectId: 'pry_ghost' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(world.inputs.calls.kpiProjects ?? 0).toBe(0);
  });

  it('passes the same scope to every scoped read', async () => {
    const world = buildReportsWorld();
    await world.getKpis.execute(owner, { clientId: 'cli_a', tagId: 'tag_a' });
    expect(world.inputs.scopes.length).toBeGreaterThan(0);
    expect(world.inputs.scopes.every((s) => s.clientId === 'cli_a' && s.tagId === 'tag_a')).toBe(
      true,
    );
  });
});

describe('GetKpis: the 18 cards', () => {
  let world: World;
  let out: KpisOutput;
  let kpi: Record<string, KpiOutput>;

  beforeEach(async () => {
    world = buildReportsWorld();
    seed(world);
    out = await world.getKpis.execute(owner, { preset: 'THIS_MONTH' });
    kpi = Object.fromEntries(out.kpis.map((k) => [k.id, k]));
  });

  it('answers all 18 in catalog order with the range and the previous range', () => {
    expect(out.kpis.map((k) => k.id)).toEqual([...KPI_ID_VALUES]);
    expect(out.kpis).toHaveLength(18);
    expect(out.range).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(out.previousRange).toEqual({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    for (const card of out.kpis) expect(card.sparkline.length).toBeLessThanOrEqual(12);
  });

  it('units follow the catalog', () => {
    expect(kpi.MRR?.unit).toBe('USD');
    expect(kpi.DSO?.unit).toBe('DAYS');
    expect(kpi.RUNWAY?.unit).toBe('MONTHS');
    expect(kpi.NEW_CLIENTS?.unit).toBe('COUNT');
    expect(kpi.COLLECTION_RATE?.unit).toBe('PERCENT');
  });

  it('MRR and ARR sum the monthly USD snapshots of the charges active at the close (DT-100)', () => {
    // Oct 31: 100 + 50; Sep 30: 100 (the 70 charge ended Sep 15; the paused one never counts).
    expect(kpi.MRR).toMatchObject({
      value: '150.00',
      previousValue: '100.00',
      changePercent: '50.00',
    });
    expect(kpi.ARR).toMatchObject({
      value: '1800.00',
      previousValue: '1200.00',
      changePercent: '50.00',
    });
    expect(kpi.MRR?.sparkline).toHaveLength(12);
    expect(kpi.MRR?.sparkline[0]).toEqual({ period: '2025-11', value: '70.00' });
    expect(kpi.MRR?.sparkline.slice(-3)).toEqual([
      { period: '2026-08', value: '170.00' },
      { period: '2026-09', value: '100.00' },
      { period: '2026-10', value: '150.00' },
    ]);
  });

  it('DSO: receivable at the close over billed, times the days of the period', () => {
    // 1150 / 1000 * 31 = 35.65; previous 400 / 500 * 30 = 24.00.
    expect(kpi.DSO).toMatchObject({
      value: '35.65',
      previousValue: '24.00',
      changePercent: '48.54',
    });
  });

  it('collection rate, delinquency and operating margin', () => {
    expect(kpi.COLLECTION_RATE).toMatchObject({
      value: '25.00',
      previousValue: '20.00',
      changePercent: '25.00',
    });
    expect(kpi.COLLECTION_RATE?.sparkline).toEqual([
      { period: '2026-09', value: '20.00' },
      { period: '2026-10', value: '25.00' },
    ]);
    // 400 overdue of 1150; previous 400 of 400.
    expect(kpi.DELINQUENCY).toMatchObject({
      value: '34.78',
      previousValue: '100.00',
      changePercent: '-65.22',
    });
    expect(kpi.OPERATING_MARGIN).toMatchObject({
      value: '80.00',
      previousValue: '80.00',
      changePercent: '0.00',
    });
  });

  it('project margin pools the projects that collected and lists the top five', () => {
    // (300 + 100 - 100) / 400 = 75; previous (200 - 20) / 200 = 90.
    expect(kpi.PROJECT_MARGIN).toMatchObject({ value: '75.00', previousValue: '90.00' });
    expect(kpi.PROJECT_MARGIN?.breakdown).toEqual([
      { key: 'pry_a', label: 'Web', value: '66.67' },
      { key: 'pry_b', label: 'App', value: '100.00' },
    ]);
  });

  it('fixed monthly expense sums the active recurring snapshots', () => {
    expect(kpi.FIXED_MONTHLY_EXPENSE).toMatchObject({
      value: '42.50',
      previousValue: '42.50',
      changePercent: '0.00',
    });
  });

  it('runway: balance at the latest rate over the average of the last three months', () => {
    // 1000 + 3600 / 36 = 1100 (EUR has no rate); (30 + 20 + 50) / 3 = 33.33 -> 33.00.
    // Previous: (10 + 30 + 20) / 3 = 20.00 -> 55.00.
    expect(kpi.RUNWAY).toMatchObject({
      value: '33.00',
      previousValue: '55.00',
      changePercent: '-40.00',
    });
  });

  it('revenue concentration and client LTV come from the confirmed allocations', () => {
    expect(kpi.REVENUE_CONCENTRATION).toMatchObject({
      value: '75.00',
      previousValue: '100.00',
      changePercent: '-25.00',
    });
    expect(kpi.REVENUE_CONCENTRATION?.breakdown).toEqual([
      { key: 'top1', value: '75.00' },
      { key: 'top3', value: '100.00' },
    ]);
    expect(kpi.CLIENT_LTV).toMatchObject({
      value: '500.00',
      previousValue: '750.00',
      changePercent: '-33.33',
    });
    expect(kpi.CLIENT_LTV?.breakdown).toEqual([
      { key: 'cli_b', label: 'Zafiro', value: '750.00' },
      { key: 'cli_a', label: 'Kairos', value: '250.00' },
    ]);
  });

  it('average ticket, new clients and prospect conversion over the period', () => {
    expect(kpi.AVG_PROJECT_TICKET).toMatchObject({
      value: '3000.00',
      previousValue: '1000.00',
      changePercent: '200.00',
    });
    expect(kpi.NEW_CLIENTS).toMatchObject({
      value: '2',
      previousValue: '1',
      changePercent: '100.00',
    });
    expect(kpi.PROSPECT_CONVERSION).toMatchObject({
      value: '50.00',
      previousValue: '100.00',
      changePercent: '-50.00',
    });
  });

  it('delivery KPIs use the projects delivered in the period', () => {
    expect(kpi.AVG_PROJECT_DURATION).toMatchObject({
      value: '65.00',
      previousValue: '40.00',
      changePercent: '62.50',
    });
    expect(kpi.ON_TIME_PROJECTS).toMatchObject({
      value: '100.00',
      previousValue: '0.00',
      changePercent: null,
    });
  });

  it('stack usage counts technologies and lists the most used', () => {
    expect(kpi.STACK_USAGE?.value).toBe('2');
    expect(kpi.STACK_USAGE?.breakdown).toEqual([
      { key: 'tec_1', label: 'Next.js', value: '3' },
      { key: 'tec_2', label: 'Nest', value: '1' },
    ]);
  });

  it('document coverage: a signed contract and a current NDA at the close', () => {
    // Oct 9: pry_b NDA expired Oct 1 -> 1 of 2; Sep 30: still current -> 2 of 2.
    expect(kpi.DOCUMENT_COVERAGE).toMatchObject({
      value: '50.00',
      previousValue: '100.00',
      changePercent: '-50.00',
    });
  });

  it('HU-31 CA2: another range changes the value, the comparison and the sparkline end', async () => {
    const september = await world.getKpis.execute(owner, { preset: 'PREVIOUS_MONTH' });
    const card = september.kpis.find((k) => k.id === 'NEW_CLIENTS');
    expect(card?.value).toBe('1');
    expect(card?.value).not.toBe(kpi.NEW_CLIENTS?.value);
    expect(card?.sparkline.at(-1)?.period).toBe('2026-09');
    expect(kpi.NEW_CLIENTS?.previousValue).toBe(card?.value);
    expect(september.kpis.find((k) => k.id === 'MRR')?.value).toBe('100.00');
  });

  it('a card without data is null, never NaN', async () => {
    const empty = buildReportsWorld();
    const result = await empty.getKpis.execute(owner, { preset: 'THIS_MONTH' });
    const byId = Object.fromEntries(result.kpis.map((k) => [k.id, k]));
    expect(byId.DSO).toMatchObject({
      value: null,
      previousValue: null,
      changePercent: null,
      sparkline: [],
    });
    expect(byId.RUNWAY?.value).toBeNull();
    expect(byId.MRR).toMatchObject({ value: '0.00', changePercent: null });
    expect(byId.NEW_CLIENTS?.value).toBe('0');
  });
});

describe('GetKpis: set-based reads', () => {
  it('reads every input once, however many cards and sparkline months', async () => {
    const world = buildReportsWorld();
    seed(world);
    const counted = { sumByKind: 0, monthlySeries: 0, other: 0 };
    const facts = world.facts;
    const original = {
      sumByKind: facts.sumByKind.bind(facts),
      monthlySeries: facts.monthlySeries.bind(facts),
    };
    facts.sumByKind = (...args) => {
      counted.sumByKind += 1;
      return original.sumByKind(...args);
    };
    facts.monthlySeries = ((...args: Parameters<typeof original.monthlySeries>) => {
      counted.monthlySeries += 1;
      return original.monthlySeries(...args);
    }) as typeof facts.monthlySeries;

    await world.getKpis.execute(owner, { preset: 'LAST_12_MONTHS' });

    // The range, the previous range, the 14-month series and the 3 months before the previous close.
    expect(counted.sumByKind).toBe(2);
    expect(counted.monthlySeries).toBe(2);
    for (const method of [
      'receivableAt',
      'collectionsByClientDay',
      'projectFlows',
      'recurringCharges',
      'recurringExpenses',
      'accountBalances',
      'kpiProjects',
      'kpiClients',
    ]) {
      expect(world.inputs.calls[method], method).toBe(1);
    }
    // Existence checks (none without ids) and at most one label read per kind.
    expect(world.inputs.totalCalls).toBeLessThanOrEqual(8 + 3);
  });

  it('a breakdown key that no longer resolves keeps its key as label', async () => {
    const empty = buildReportsWorld();
    seed(empty);
    empty.inputs.labelRows.CLIENT.length = 0;
    const result = await empty.getKpis.execute(owner, { preset: 'THIS_MONTH' });
    const ltv = result.kpis.find((k) => k.id === 'CLIENT_LTV');
    expect(ltv?.breakdown?.map((b) => b.label)).toEqual(['cli_b', 'cli_a']);
  });

  it('values the balance of an account in a currency with no rate at zero, never a failure', async () => {
    const world = buildReportsWorld();
    world.inputs.balances = [{ currency: 'EUR', balance: '500.00' }];
    world.facts.addFact({ kind: 'EXPENSE_PAID', date: '2026-10-02', amountUsd: '30.00' });
    const result = await world.getKpis.execute(owner, { preset: 'THIS_MONTH' });
    expect(result.kpis.find((k) => k.id === 'RUNWAY')?.value).toBe('0.00');
  });

  it('project margin leaves out a project whose margin has no base and tolerates windows without data', async () => {
    const world = buildReportsWorld();
    world.inputs.projectDays = [
      { projectId: 'pry_a', date: '2026-10-02', collectedUsd: '0.00', expensesUsd: '5.00' },
    ];
    const result = await world.getKpis.execute(owner, { preset: 'THIS_MONTH' });
    const margin = result.kpis.find((k) => k.id === 'PROJECT_MARGIN');
    expect(margin?.value).toBeNull();
    expect(margin?.breakdown).toEqual([]);
  });
});
