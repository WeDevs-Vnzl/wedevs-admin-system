import { describe, expect, it } from 'vitest';
import type { SeedFact } from '../../support/fakes/in-memory-finance-facts-read';
import { buildReportsWorld, userOf } from './reports-world';

const owner = userOf('OWNER');

const fact = (extra: SeedFact): SeedFact => extra;

describe('GetReport: access, slug and filters', () => {
  it.each(['MEMBER', 'VIEWER'] as const)(
    'is Owner and Admin only: %s gets FORBIDDEN',
    async (role) => {
      const { getReport, inputs } = buildReportsWorld();
      await expect(
        getReport.execute(userOf(role), { slug: 'collected-by-month' }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(inputs.totalCalls).toBe(0);
    },
  );

  it('lets Admin read', async () => {
    const { getReport } = buildReportsWorld();
    await expect(
      getReport.execute(userOf('ADMIN'), { slug: 'collected-by-month' }),
    ).resolves.toMatchObject({ reportId: 'COLLECTED_BY_MONTH' });
  });

  it('answers NOT_FOUND for a slug outside the whitelist, after the grant', async () => {
    const { getReport } = buildReportsWorld();
    await expect(getReport.execute(owner, { slug: 'kpis-x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(getReport.execute(userOf('MEMBER'), { slug: 'kpis-x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each([
    ['THIS_MONTH', {}, '2026-10-01', '2026-10-31'],
    ['PREVIOUS_MONTH', {}, '2026-09-01', '2026-09-30'],
    ['QUARTER', {}, '2026-10-01', '2026-12-31'],
    ['YEAR', {}, '2026-01-01', '2026-12-31'],
    ['LAST_12_MONTHS', {}, '2025-11-01', '2026-10-31'],
    ['CUSTOM', { from: '2026-09-15', to: '2026-10-05' }, '2026-09-15', '2026-10-05'],
  ] as const)('resolves %s from the Caracas day', async (preset, extra, dateFrom, dateTo) => {
    const { getReport } = buildReportsWorld();
    const result = await getReport.execute(owner, { slug: 'collected-by-month', preset, ...extra });
    expect(result.range).toEqual({ dateFrom, dateTo });
  });

  it('defaults to the last 12 months', async () => {
    const { getReport } = buildReportsWorld();
    const result = await getReport.execute(owner, { slug: 'collected-by-month' });
    expect(result.range).toEqual({ dateFrom: '2025-11-01', dateTo: '2026-10-31' });
  });

  it('rejects an unknown preset without the DTO', async () => {
    const { getReport } = buildReportsWorld();
    await expect(
      getReport.execute(owner, { slug: 'collected-by-month', preset: 'DECADE' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { preset: ['reports.validation.preset'] },
    });
  });

  it('rejects an inverted custom range under the query names', async () => {
    const { getReport } = buildReportsWorld();
    await expect(
      getReport.execute(owner, {
        slug: 'collected-by-month',
        preset: 'CUSTOM',
        from: '2026-10-05',
        to: '2026-09-01',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { to: ['reports.validation.rangeInverted'] },
    });
  });

  it('requires both dates for CUSTOM', async () => {
    const { getReport } = buildReportsWorld();
    await expect(
      getReport.execute(owner, {
        slug: 'collected-by-month',
        preset: 'CUSTOM',
        from: '2026-10-05',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { to: ['reports.validation.customRangeRequired'] },
    });
  });

  it('caps a custom range at 120 months', async () => {
    const { getReport } = buildReportsWorld();
    await expect(
      getReport.execute(owner, {
        slug: 'collected-by-month',
        preset: 'CUSTOM',
        from: '2000-01-01',
        to: '2026-10-05',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { to: ['reports.validation.rangeTooLong'] },
    });
  });

  it('resolves a client, project and tag id before reading (C14)', async () => {
    const { getReport, inputs, facts } = buildReportsWorld();
    for (const [key, value] of [
      ['clientId', 'cli_ghost'],
      ['projectId', 'pry_ghost'],
      ['tagId', 'tag_ghost'],
    ] as const) {
      await expect(
        getReport.execute(owner, { slug: 'collected-by-month', [key]: value }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(inputs.calls.taxesByMonth ?? 0).toBe(0);
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '10.00', clientId: 'cli_a' }),
    );
    const ok = await getReport.execute(owner, {
      slug: 'collected-by-month',
      clientId: 'cli_a',
      projectId: 'pry_a',
      tagId: 'tag_a',
    });
    expect(ok.reportId).toBe('COLLECTED_BY_MONTH');
  });
});

describe('GetReport: the ten reports', () => {
  it('collected by month: zeros for months without facts', async () => {
    const { getReport, facts } = buildReportsWorld();
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-09-25', amountUsd: '300.00' }));
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-09-28', amountUsd: '500.00' }));
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '100.00' }));
    const result = await getReport.execute(owner, { slug: 'collected-by-month' });
    if (result.reportId !== 'COLLECTED_BY_MONTH') throw new Error(result.reportId);
    expect(result.currency).toBe('USD');
    expect(result.points).toHaveLength(12);
    expect(result.points[0]).toEqual({ period: '2025-11', value: '0.00' });
    expect(result.points.slice(-2)).toEqual([
      { period: '2026-09', value: '800.00' },
      { period: '2026-10', value: '100.00' },
    ]);
  });

  it('billed vs collected: two series over the same months', async () => {
    const { getReport, facts } = buildReportsWorld();
    facts.addFact(fact({ kind: 'BILLED', date: '2026-08-15', amountUsd: '928.00' }));
    facts.addFact(fact({ kind: 'BILLED', date: '2026-10-01', amountUsd: '3976.01' }));
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-09-25', amountUsd: '800.00' }));
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '100.00' }));
    const result = await getReport.execute(owner, { slug: 'billed-vs-collected' });
    if (result.reportId !== 'BILLED_VS_COLLECTED') throw new Error(result.reportId);
    expect(result.chart.periods).toHaveLength(12);
    const series = Object.fromEntries(result.chart.series.map((s) => [s.id, s.values.slice(-3)]));
    expect(series).toEqual({
      billed: ['928.00', '0.00', '3976.01'],
      collected: ['0.00', '800.00', '100.00'],
    });
  });

  it('revenue by client: labelled, largest collected first, ties by billed then id', async () => {
    const { getReport, facts, inputs } = buildReportsWorld();
    inputs.labelRows.CLIENT.push(
      { id: 'cli_a', label: 'Kairos', code: 'CLI-1' },
      { id: 'cli_b', label: 'Zafiro', code: 'CLI-2' },
    );
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-09-25', amountUsd: '900.00', clientId: 'cli_a' }),
    );
    facts.addFact(
      fact({ kind: 'BILLED', date: '2026-10-01', amountUsd: '2820.00', clientId: 'cli_a' }),
    );
    facts.addFact(
      fact({ kind: 'BILLED', date: '2026-10-01', amountUsd: '2084.01', clientId: 'cli_b' }),
    );
    const result = await getReport.execute(owner, { slug: 'revenue-by-client' });
    if (result.reportId !== 'REVENUE_BY_CLIENT') throw new Error(result.reportId);
    expect(result.rows).toEqual([
      {
        client: { type: 'CLIENT', id: 'cli_a', code: 'CLI-1', label: 'Kairos' },
        collected: '900.00',
        billed: '2820.00',
      },
      {
        client: { type: 'CLIENT', id: 'cli_b', code: 'CLI-2', label: 'Zafiro' },
        collected: '0.00',
        billed: '2084.01',
      },
    ]);
  });

  it('a row whose record has no label falls back to its id', async () => {
    const { getReport, facts } = buildReportsWorld();
    facts.addFact(
      fact({ kind: 'BILLED', date: '2026-10-01', amountUsd: '5.00', clientId: 'cli_gone' }),
    );
    const result = await getReport.execute(owner, { slug: 'revenue-by-client' });
    if (result.reportId !== 'REVENUE_BY_CLIENT') throw new Error(result.reportId);
    expect(result.rows[0]?.client).toEqual({ type: 'CLIENT', id: 'cli_gone', label: 'cli_gone' });
  });

  it('revenue by project: collected, margin and margin percent through the finance formula', async () => {
    const { getReport, facts, inputs } = buildReportsWorld();
    inputs.labelRows.PROJECT.push({ id: 'pry_a', label: 'Web', code: 'PRY-1' });
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-09-25', amountUsd: '300.00', projectId: 'pry_a' }),
    );
    facts.addFact(
      fact({ kind: 'EXPENSE_PAID', date: '2026-10-02', amountUsd: '0.60', projectId: 'pry_a' }),
    );
    facts.addFact(
      fact({ kind: 'EXPENSE_PAID', date: '2026-10-03', amountUsd: '40.00', projectId: 'pry_b' }),
    );
    const result = await getReport.execute(owner, { slug: 'revenue-by-project' });
    if (result.reportId !== 'REVENUE_BY_PROJECT') throw new Error(result.reportId);
    expect(result.rows).toEqual([
      {
        project: { type: 'PROJECT', id: 'pry_a', code: 'PRY-1', label: 'Web' },
        collected: '300.00',
        margin: '299.40',
        marginPercent: '99.80',
      },
      {
        project: { type: 'PROJECT', id: 'pry_b', label: 'pry_b' },
        collected: '0.00',
        margin: '-40.00',
        marginPercent: null,
      },
    ]);
  });

  it('receivables aging at the close: today while the range runs, buckets from the due date', async () => {
    const { getReport, facts, inputs } = buildReportsWorld();
    inputs.labelRows.CLIENT.push({ id: 'cli_a', label: 'Kairos', code: 'CLI-1' });
    const invoice = (id: string, due: string, amount: string) => {
      facts.addFact(
        fact({
          kind: 'BILLED',
          date: '2026-06-01',
          amountUsd: amount,
          clientId: 'cli_a',
          invoiceId: id,
          dueDate: due,
        }),
      );
    };
    invoice('inv_1', '2026-10-20', '100.00'); // not due: 0-30
    invoice('inv_2', '2026-09-19', '200.00'); // 20 days late: 0-30
    invoice('inv_3', '2026-08-20', '400.00'); // 50 days: 31-60
    invoice('inv_4', '2026-07-20', '800.00'); // 81 days: 61-90
    invoice('inv_5', '2026-05-01', '1600.00'); // 161 days: 90+
    const result = await getReport.execute(owner, { slug: 'receivables-aging' });
    if (result.reportId !== 'RECEIVABLES_AGING') throw new Error(result.reportId);
    expect(result.totals).toEqual({
      d0_30: '300.00',
      d31_60: '400.00',
      d61_90: '800.00',
      d90plus: '1600.00',
    });
    expect(result.rows).toEqual([
      {
        client: { type: 'CLIENT', id: 'cli_a', code: 'CLI-1', label: 'Kairos' },
        buckets: { d0_30: '300.00', d31_60: '400.00', d61_90: '800.00', d90plus: '1600.00' },
        total: '3100.00',
      },
    ]);
  });

  it('aging closes at the end of a past range', async () => {
    const { getReport, facts } = buildReportsWorld();
    facts.addFact(
      fact({
        kind: 'BILLED',
        date: '2026-06-01',
        amountUsd: '100.00',
        clientId: 'cli_a',
        invoiceId: 'inv_1',
        dueDate: '2026-07-01',
      }),
    );
    const result = await getReport.execute(owner, {
      slug: 'receivables-aging',
      preset: 'CUSTOM',
      from: '2026-06-01',
      to: '2026-08-15',
    });
    if (result.reportId !== 'RECEIVABLES_AGING') throw new Error(result.reportId);
    // 2026-08-15 less the due date 2026-07-01 is 45 days.
    expect(result.totals.d31_60).toBe('100.00');
  });

  it('expenses by month and root category, one series per category', async () => {
    const { getReport, inputs } = buildReportsWorld();
    inputs.labelRows.CATEGORY.push(
      { id: 'ecat_bank', label: 'Comisiones bancarias', code: null },
      { id: 'ecat_design', label: 'Freelancers diseño', code: null },
    );
    inputs.categoryMonths = [
      { categoryId: 'ecat_bank', month: '2026-09', amountUsd: '2.38' },
      { categoryId: 'ecat_design', month: '2026-10', amountUsd: '0.60' },
    ];
    const result = await getReport.execute(owner, { slug: 'expenses-by-month-category' });
    if (result.reportId !== 'EXPENSES_BY_MONTH_CATEGORY') throw new Error(result.reportId);
    expect(result.chart.periods).toHaveLength(12);
    const byCategory = Object.fromEntries(
      result.chart.series.map((s) => [s.id, s.values.slice(-2)]),
    );
    expect(byCategory).toEqual({
      ecat_bank: ['2.38', '0.00'],
      ecat_design: ['0.00', '0.60'],
    });
    expect(result.chart.series.every((s) => typeof s.label === 'string')).toBe(true);
    expect(result.chart.series[0]?.values).toHaveLength(12);
  });

  it('net result by month: collected minus paid expenses, negative for a loss', async () => {
    const { getReport, facts } = buildReportsWorld();
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-09-25', amountUsd: '800.00' }));
    facts.addFact(fact({ kind: 'EXPENSE_PAID', date: '2026-09-30', amountUsd: '2.38' }));
    facts.addFact(fact({ kind: 'EXPENSE_PAID', date: '2026-08-02', amountUsd: '10.00' }));
    facts.addFact(fact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '100.00' }));
    facts.addFact(fact({ kind: 'EXPENSE_PAID', date: '2026-10-02', amountUsd: '0.60' }));
    const result = await getReport.execute(owner, { slug: 'net-result-monthly' });
    if (result.reportId !== 'NET_RESULT_MONTHLY') throw new Error(result.reportId);
    expect(result.points.slice(-3)).toEqual([
      { period: '2026-08', value: '-10.00' },
      { period: '2026-09', value: '797.62' },
      { period: '2026-10', value: '99.40' },
    ]);
  });

  it('account flow: labelled rows by month then account', async () => {
    const { getReport, inputs } = buildReportsWorld();
    inputs.labelRows.ACCOUNT.push(
      { id: 'acc_b', label: 'Zelle', code: null },
      { id: 'acc_a', label: 'Cobros USD', code: null },
    );
    inputs.accountFlows = [
      { accountId: 'acc_b', month: '2026-09', inflowUsd: '0.00', outflowUsd: '100.00' },
      { accountId: 'acc_a', month: '2026-10', inflowUsd: '100.00', outflowUsd: '0.00' },
      { accountId: 'acc_a', month: '2026-09', inflowUsd: '800.00', outflowUsd: '0.00' },
    ];
    const result = await getReport.execute(owner, { slug: 'account-flow' });
    if (result.reportId !== 'ACCOUNT_FLOW') throw new Error(result.reportId);
    expect(result.rows.map((r) => [r.account.label, r.period, r.inflow, r.outflow])).toEqual([
      ['Cobros USD', '2026-09', '800.00', '0.00'],
      ['Zelle', '2026-09', '0.00', '100.00'],
      ['Cobros USD', '2026-10', '100.00', '0.00'],
    ]);
  });

  it('collections by method with their share of the total', async () => {
    const { getReport, facts, inputs } = buildReportsWorld();
    inputs.labelRows.METHOD.push(
      { id: 'pm_zelle', label: 'Zelle', code: 'ZELLE' },
      { id: 'pm_pm', label: 'Pago móvil', code: 'PAGO_MOVIL' },
    );
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-09-25', amountUsd: '200.00', methodId: 'pm_zelle' }),
    );
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-09-26', amountUsd: '100.00', methodId: 'pm_pm' }),
    );
    const result = await getReport.execute(owner, { slug: 'collections-by-method' });
    if (result.reportId !== 'COLLECTIONS_BY_METHOD') throw new Error(result.reportId);
    expect(result.rows).toEqual([
      { methodId: 'pm_zelle', methodCode: 'ZELLE', collected: '200.00', share: '66.67' },
      { methodId: 'pm_pm', methodCode: 'PAGO_MOVIL', collected: '100.00', share: '33.33' },
    ]);
  });

  it('taxes registered: IVA per rate by month, withholdings and IGTF, totals across months', async () => {
    const { getReport, inputs } = buildReportsWorld();
    inputs.taxes = {
      rates: [
        { month: '2026-09', ivaRate: '16.00', taxBaseUsd: '100.00', ivaAmountUsd: '16.00' },
        { month: '2026-10', ivaRate: '16.00', taxBaseUsd: '2100.00', ivaAmountUsd: '336.00' },
        { month: '2026-10', ivaRate: '8.00', taxBaseUsd: '500.00', ivaAmountUsd: '40.01' },
        { month: '2026-10', ivaRate: '0.00', taxBaseUsd: '200.00', ivaAmountUsd: '0.00' },
      ],
      withholdings: [
        {
          month: '2026-10',
          ivaWithheldUsd: '10.00',
          islrWithheldUsd: '5.00',
          otherWithheldUsd: '1.00',
          igtfUsd: '3.00',
        },
      ],
    };
    const result = await getReport.execute(owner, {
      slug: 'taxes-registered',
      preset: 'THIS_MONTH',
    });
    if (result.reportId !== 'TAXES_REGISTERED') throw new Error(result.reportId);
    expect(result.months.map((m) => m.period)).toEqual(['2026-10']);
    expect(result.totals.ivaByRate).toEqual([
      { ivaRate: '16.00', taxBase: '2100.00', ivaAmount: '336.00' },
      { ivaRate: '8.00', taxBase: '500.00', ivaAmount: '40.01' },
      { ivaRate: '0.00', taxBase: '200.00', ivaAmount: '0.00' },
    ]);
    expect(result.totals.ivaTotal).toBe('376.01');
    expect(result.totals).toMatchObject({
      ivaWithheld: '10.00',
      islrWithheld: '5.00',
      otherWithheld: '1.00',
      igtf: '3.00',
    });
    expect(result.months[0]?.ivaByRate).toEqual(result.totals.ivaByRate);

    const wide = await getReport.execute(owner, { slug: 'taxes-registered', preset: 'QUARTER' });
    if (wide.reportId !== 'TAXES_REGISTERED') throw new Error(wide.reportId);
    expect(wide.months.map((m) => m.period)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(wide.months[1]).toMatchObject({ ivaByRate: [], ivaTotal: '0.00', igtf: '0.00' });
  });

  it('a filter reaches every read, as given', async () => {
    const { getReport, inputs } = buildReportsWorld();
    for (const slug of ['expenses-by-month-category', 'account-flow', 'taxes-registered']) {
      await getReport.execute(owner, { slug, clientId: 'cli_a', tagId: 'tag_a' });
    }
    expect(inputs.scopes).toEqual(Array(3).fill({ clientId: 'cli_a', tagId: 'tag_a' }));
  });

  it('every report answers for its id', async () => {
    const { getReport } = buildReportsWorld();
    for (const slug of [
      'collected-by-month',
      'billed-vs-collected',
      'revenue-by-client',
      'revenue-by-project',
      'receivables-aging',
      'expenses-by-month-category',
      'net-result-monthly',
      'account-flow',
      'collections-by-method',
      'taxes-registered',
    ]) {
      const result = await getReport.execute(owner, { slug });
      expect(result.reportId).toBe(slug.toUpperCase().replaceAll('-', '_'));
    }
  });

  it('labels fall back to ids for a category, a method and an account that no longer resolve', async () => {
    const { getReport, facts, inputs } = buildReportsWorld();
    inputs.categoryMonths = [{ categoryId: 'ecat_gone', month: '2026-10', amountUsd: '5.00' }];
    inputs.accountFlows = [
      { accountId: 'acc_gone', month: '2026-10', inflowUsd: '1.00', outflowUsd: '0.00' },
    ];
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '10.00', methodId: 'pm_gone' }),
    );
    const expenses = await getReport.execute(owner, { slug: 'expenses-by-month-category' });
    if (expenses.reportId !== 'EXPENSES_BY_MONTH_CATEGORY') throw new Error(expenses.reportId);
    expect(expenses.chart.series[0]).toMatchObject({ id: 'ecat_gone', label: 'ecat_gone' });
    const flow = await getReport.execute(owner, { slug: 'account-flow' });
    if (flow.reportId !== 'ACCOUNT_FLOW') throw new Error(flow.reportId);
    expect(flow.rows[0]?.account.label).toBe('acc_gone');
    const methods = await getReport.execute(owner, { slug: 'collections-by-method' });
    if (methods.reportId !== 'COLLECTIONS_BY_METHOD') throw new Error(methods.reportId);
    expect(methods.rows[0]).toMatchObject({ methodId: 'pm_gone', methodCode: 'pm_gone' });
  });

  it('a method without a code is shown by its label', async () => {
    const { getReport, facts, inputs } = buildReportsWorld();
    inputs.labelRows.METHOD.push({ id: 'pm_x', label: 'Efectivo', code: null });
    facts.addFact(
      fact({ kind: 'COLLECTED', date: '2026-10-02', amountUsd: '10.00', methodId: 'pm_x' }),
    );
    const result = await getReport.execute(owner, { slug: 'collections-by-method' });
    if (result.reportId !== 'COLLECTIONS_BY_METHOD') throw new Error(result.reportId);
    expect(result.rows[0]?.methodCode).toBe('Efectivo');
  });

  it('collections by method with nothing collected is an empty table, not a division by zero', async () => {
    const { getReport } = buildReportsWorld();
    const result = await getReport.execute(owner, { slug: 'collections-by-method' });
    if (result.reportId !== 'COLLECTIONS_BY_METHOD') throw new Error(result.reportId);
    expect(result.rows).toEqual([]);
  });

  it('taxes: a month with withholdings but no IVA rows still lists them', async () => {
    const { getReport, inputs } = buildReportsWorld();
    inputs.taxes = {
      rates: [],
      withholdings: [
        {
          month: '2026-10',
          ivaWithheldUsd: '0.00',
          islrWithheldUsd: '0.00',
          otherWithheldUsd: '0.00',
          igtfUsd: '4.00',
        },
      ],
    };
    const result = await getReport.execute(owner, {
      slug: 'taxes-registered',
      preset: 'THIS_MONTH',
    });
    if (result.reportId !== 'TAXES_REGISTERED') throw new Error(result.reportId);
    expect(result.months[0]).toMatchObject({ ivaByRate: [], igtf: '4.00' });
    expect(result.totals.igtf).toBe('4.00');
  });

  it('the largest collected goes first and ties break on billed, then id', async () => {
    const { getReport, facts } = buildReportsWorld();
    for (const [clientId, billed] of [
      ['cli_b', '10.00'],
      ['cli_a', '10.00'],
      ['cli_c', '20.00'],
    ] as const) {
      facts.addFact(fact({ kind: 'BILLED', date: '2026-10-01', amountUsd: billed, clientId }));
    }
    const result = await getReport.execute(owner, { slug: 'revenue-by-client' });
    if (result.reportId !== 'REVENUE_BY_CLIENT') throw new Error(result.reportId);
    expect(result.rows.map((r) => r.client.id)).toEqual(['cli_c', 'cli_a', 'cli_b']);
  });

  it('does not swallow an unexpected failure of the range', async () => {
    const { getReport } = buildReportsWorld();
    await expect(
      getReport.execute(owner, {
        slug: 'collected-by-month',
        preset: 'CUSTOM',
        from: '2026-02-30',
        to: '2026-03-01',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { from: ['validation.date.invalid'] },
    });
  });
});
