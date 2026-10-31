import { beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../../../test/support/fakes/fixed-clock';
import {
  InMemoryFinanceSources,
  InMemoryReadModelWriter,
} from '../../../../test/finance/read-models/fakes';
import type {
  ClientMetricsSource,
  InvoiceFactSource,
  PaymentFactSource,
  ProjectMetricsSource,
} from './ports/finance-sources.port';
import { FinanceProjector } from './finance-projector';

const log: string[] = [];
let sources: InMemoryFinanceSources;
let writer: InMemoryReadModelWriter;
let projector: FinanceProjector;
const clock = new FixedClock('2026-03-10T15:00:00.000Z');

beforeEach(() => {
  log.length = 0;
  sources = new InMemoryFinanceSources(log);
  writer = new InMemoryReadModelWriter(log);
  projector = new FinanceProjector(sources, writer, clock);
});

const invoice = (overrides: Partial<InvoiceFactSource> = {}): InvoiceFactSource => ({
  id: 'inv_1',
  clientId: 'cli_1',
  status: 'EMITIDA',
  isDraft: false,
  archived: false,
  issueDate: '2026-02-01',
  dueDate: '2026-03-01',
  usdRate: '1',
  totalUsd: '100.00',
  ivaWithheld: '0.00',
  islrWithheld: '0.00',
  otherWithheld: '0.00',
  lines: [
    { projectId: 'pry_1', netAmount: '60.00' },
    { projectId: 'pry_2', netAmount: '40.00' },
  ],
  taxLines: [],
  ...overrides,
});

const payment = (overrides: Partial<PaymentFactSource> = {}): PaymentFactSource => ({
  id: 'pay_1',
  clientId: 'cli_1',
  accountId: 'acc_1',
  methodId: 'met_1',
  date: '2026-02-10',
  status: 'CONFIRMADO',
  archived: false,
  usdRate: '1',
  igtfAmount: '0.00',
  allocations: [],
  ...overrides,
});

describe('projectInvoice (data-rules Δ5, Q-BE3-7)', () => {
  it('splits BILLED by line net amount and keeps the due date for aging', async () => {
    sources.invoices.set('inv_1', invoice());
    await projector.projectInvoice('inv_1');
    expect(writer.facts.get('INVOICE:inv_1')).toEqual([
      expect.objectContaining({
        kind: 'BILLED',
        date: '2026-02-01',
        amountUsd: '60.00',
        clientId: 'cli_1',
        projectId: 'pry_1',
        invoiceId: 'inv_1',
        dueDate: '2026-03-01',
      }),
      expect.objectContaining({ kind: 'BILLED', amountUsd: '40.00', projectId: 'pry_2' }),
    ]);
  });

  it('puts the rounding residue on the largest line so the parts sum to totalUsd', async () => {
    sources.invoices.set(
      'inv_1',
      invoice({
        totalUsd: '100.00',
        lines: [
          { projectId: 'a', netAmount: '1' },
          { projectId: 'b', netAmount: '1' },
          { projectId: 'c', netAmount: '1' },
        ],
      }),
    );
    await projector.projectInvoice('inv_1');
    const parts = (writer.facts.get('INVOICE:inv_1') ?? []).map((fact) => fact.amountUsd);
    expect(parts).toEqual(['33.34', '33.33', '33.33']);
  });

  it('keeps one null-project BILLED row when the invoice has no lines', async () => {
    sources.invoices.set('inv_1', invoice({ lines: [] }));
    await projector.projectInvoice('inv_1');
    expect(writer.facts.get('INVOICE:inv_1')).toEqual([
      expect.objectContaining({ kind: 'BILLED', amountUsd: '100.00', projectId: null }),
    ]);
  });

  it('puts everything on the first line when every weight is zero', async () => {
    sources.invoices.set(
      'inv_1',
      invoice({
        lines: [
          { projectId: 'a', netAmount: '0.00' },
          { projectId: 'b', netAmount: '0.00' },
        ],
      }),
    );
    await projector.projectInvoice('inv_1');
    expect(writer.facts.get('INVOICE:inv_1')).toEqual([
      expect.objectContaining({ amountUsd: '100.00', projectId: 'a' }),
    ]);
  });

  it('adds IVA and withholding facts at the invoice rate', async () => {
    sources.invoices.set(
      'inv_1',
      invoice({
        usdRate: '40',
        totalUsd: '116.00',
        ivaWithheld: '400.00',
        islrWithheld: '80.00',
        otherWithheld: '40.00',
        lines: [{ projectId: 'pry_1', netAmount: '4000.00' }],
        taxLines: [{ ivaRate: '16', ivaAmount: '640.00' }],
      }),
    );
    await projector.projectInvoice('inv_1');
    const byKind = Object.fromEntries(
      (writer.facts.get('INVOICE:inv_1') ?? []).map((fact) => [fact.kind, fact]),
    );
    expect(byKind.IVA).toMatchObject({ amountUsd: '16.00', ivaRate: '16', invoiceId: 'inv_1' });
    expect(byKind.WITHHELD_IVA).toMatchObject({ amountUsd: '10.00' });
    expect(byKind.WITHHELD_ISLR).toMatchObject({ amountUsd: '2.00' });
    expect(byKind.WITHHELD_OTHER).toMatchObject({ amountUsd: '1.00' });
  });

  it.each([
    ['a draft', { isDraft: true }],
    ['a BORRADOR', { status: 'BORRADOR' as const }],
    ['a voided invoice', { status: 'ANULADA' as const }],
    ['an archived invoice', { archived: true }],
  ])('produces no facts for %s and removes the old ones', async (_label, overrides) => {
    writer.facts.set('INVOICE:inv_1', [{ kind: 'BILLED', date: '2026-02-01', amountUsd: '1.00' }]);
    sources.invoices.set('inv_1', invoice(overrides));
    await projector.projectInvoice('inv_1');
    expect(writer.facts.get('INVOICE:inv_1')).toEqual([]);
  });

  it('removes the facts of an invoice that no longer exists', async () => {
    writer.facts.set('INVOICE:gone', [{ kind: 'BILLED', date: '2026-02-01', amountUsd: '1.00' }]);
    await projector.projectInvoice('gone');
    expect(writer.facts.get('INVOICE:gone')).toEqual([]);
  });
});

describe('projectPayment (DT-98, Q-BE3-7)', () => {
  it('splits each allocation per project line at the allocation amountUsd', async () => {
    sources.payments.set(
      'pay_1',
      payment({
        allocations: [
          {
            invoiceId: 'inv_1',
            amountUsd: '50.00',
            invoiceLines: [
              { projectId: 'pry_1', netAmount: '75.00' },
              { projectId: 'pry_2', netAmount: '25.00' },
            ],
          },
          { invoiceId: 'inv_2', amountUsd: '10.00', invoiceLines: [] },
        ],
      }),
    );
    await projector.projectPayment('pay_1');
    expect(writer.facts.get('PAYMENT:pay_1')).toEqual([
      expect.objectContaining({
        kind: 'COLLECTED',
        date: '2026-02-10',
        amountUsd: '37.50',
        projectId: 'pry_1',
        invoiceId: 'inv_1',
        accountId: 'acc_1',
        methodId: 'met_1',
        clientId: 'cli_1',
      }),
      expect.objectContaining({ amountUsd: '12.50', projectId: 'pry_2' }),
      expect.objectContaining({ amountUsd: '10.00', projectId: null, invoiceId: 'inv_2' }),
    ]);
  });

  it('adds the IGTF fact in USD at the payment rate', async () => {
    sources.payments.set('pay_1', payment({ usdRate: '40', igtfAmount: '120.00' }));
    await projector.projectPayment('pay_1');
    expect(writer.facts.get('PAYMENT:pay_1')).toEqual([
      expect.objectContaining({ kind: 'IGTF', amountUsd: '3.00', accountId: 'acc_1' }),
    ]);
  });

  it.each(['PENDIENTE_VERIFICACION', 'ANULADO'] as const)(
    'produces no facts for a %s payment',
    async (status) => {
      sources.payments.set(
        'pay_1',
        payment({
          status,
          allocations: [{ invoiceId: 'inv_1', amountUsd: '5.00', invoiceLines: [] }],
        }),
      );
      await projector.projectPayment('pay_1');
      expect(writer.facts.get('PAYMENT:pay_1')).toEqual([]);
    },
  );

  it('produces no facts for an archived payment', async () => {
    sources.payments.set('pay_1', payment({ archived: true, igtfAmount: '3.00' }));
    await projector.projectPayment('pay_1');
    expect(writer.facts.get('PAYMENT:pay_1')).toEqual([]);
  });
});

describe('projectExpense, projectTransfer, projectMovement', () => {
  it('records EXPENSE_PAID only for a paid, live expense, dated by the paid date', async () => {
    const expense = {
      id: 'exp_1',
      status: 'PAGADO' as const,
      archived: false,
      paidDate: '2026-02-20',
      accountId: 'acc_1',
      categoryId: 'cat_1',
      projectId: 'pry_1',
      amountUsd: '25.00',
    };
    sources.expenses.set('exp_1', expense);
    await projector.projectExpense('exp_1');
    expect(writer.facts.get('EXPENSE:exp_1')).toEqual([
      expect.objectContaining({
        kind: 'EXPENSE_PAID',
        date: '2026-02-20',
        amountUsd: '25.00',
        accountId: 'acc_1',
        categoryId: 'cat_1',
        projectId: 'pry_1',
      }),
    ]);
    sources.expenses.set('exp_1', { ...expense, status: 'PENDIENTE' });
    await projector.projectExpense('exp_1');
    expect(writer.facts.get('EXPENSE:exp_1')).toEqual([]);
    sources.expenses.set('exp_1', { ...expense, archived: true });
    await projector.projectExpense('exp_1');
    expect(writer.facts.get('EXPENSE:exp_1')).toEqual([]);
  });

  it('records one TRANSFER_OUT and one TRANSFER_IN with the transfer amountUsd', async () => {
    sources.transfers.set('trf_1', {
      id: 'trf_1',
      archived: false,
      date: '2026-02-05',
      fromAccountId: 'acc_1',
      toAccountId: 'acc_2',
      amountUsd: '200.00',
    });
    await projector.projectTransfer('trf_1');
    expect(writer.facts.get('TRANSFER:trf_1')).toEqual([
      expect.objectContaining({ kind: 'TRANSFER_OUT', accountId: 'acc_1', amountUsd: '200.00' }),
      expect.objectContaining({ kind: 'TRANSFER_IN', accountId: 'acc_2', amountUsd: '200.00' }),
    ]);
    sources.transfers.set('trf_1', {
      id: 'trf_1',
      archived: true,
      date: '2026-02-05',
      fromAccountId: 'acc_1',
      toAccountId: 'acc_2',
      amountUsd: '200.00',
    });
    await projector.projectTransfer('trf_1');
    expect(writer.facts.get('TRANSFER:trf_1')).toEqual([]);
  });

  it('maps movement types to MOVEMENT_IN and MOVEMENT_OUT; an AJUSTE keeps its sign', async () => {
    const base = { archived: false, date: '2026-02-06', accountId: 'acc_1' };
    const cases: [string, 'APORTE_CAPITAL' | 'RETIRO_SOCIO' | 'AJUSTE', string, string, string][] =
      [
        ['mov_in', 'APORTE_CAPITAL', '100.00', 'MOVEMENT_IN', '100.00'],
        ['mov_out', 'RETIRO_SOCIO', '40.00', 'MOVEMENT_OUT', '40.00'],
        ['mov_adj_up', 'AJUSTE', '5.00', 'MOVEMENT_IN', '5.00'],
        ['mov_adj_down', 'AJUSTE', '-5.00', 'MOVEMENT_IN', '-5.00'],
      ];
    for (const [id, type, amountUsd] of cases) {
      sources.movements.set(id, { id, type, amountUsd, ...base });
    }
    for (const [id, , , kind, expected] of cases) {
      await projector.projectMovement(id);
      expect(writer.facts.get(`MOVEMENT:${id}`)).toEqual([
        expect.objectContaining({ kind, amountUsd: expected, accountId: 'acc_1' }),
      ]);
    }
  });

  it('produces no movement fact for an archived movement', async () => {
    sources.movements.set('mov_1', {
      id: 'mov_1',
      type: 'APORTE_CAPITAL',
      amountUsd: '1.00',
      archived: true,
      date: '2026-02-06',
      accountId: 'acc_1',
    });
    await projector.projectMovement('mov_1');
    expect(writer.facts.get('MOVEMENT:mov_1')).toEqual([]);
  });
});

describe('projectAccount (DT-106, §9.7)', () => {
  it('writes the balance from accountBalance, applying the movement sign, at the clock instant', async () => {
    sources.accounts.set('acc_1', {
      id: 'acc_1',
      activity: {
        openingBalance: '100.00',
        payments: [
          { date: '2026-02-01', netCredited: '50.00', status: 'CONFIRMADO' },
          { date: '2026-02-02', netCredited: '999.00', status: 'PENDIENTE_VERIFICACION' },
        ],
        expenses: [
          { date: '2026-02-03', amount: '20.00', accountAmount: null, status: 'PAGADO' },
          { date: '2026-02-03', amount: '30.00', accountAmount: '12.00', status: 'PAGADO' },
          { date: '2026-02-03', amount: '77.00', accountAmount: null, status: 'PENDIENTE' },
        ],
        transfersIn: [{ date: '2026-02-04', amountTo: '10.00' }],
        transfersOut: [{ date: '2026-02-04', amountFrom: '5.00', feeAmount: '1.00' }],
        movements: [
          { date: '2026-02-05', type: 'APORTE_CAPITAL', amount: '40.00' },
          { date: '2026-02-05', type: 'RETIRO_SOCIO', amount: '15.00' },
          { date: '2026-02-05', type: 'AJUSTE', amount: '-2.00' },
        ],
      },
    });
    await projector.projectAccount('acc_1');
    // 100 + 50 − 20 − 12 + 10 − 6 + 40 − 15 − 2
    expect(writer.balances.get('acc_1')).toEqual({ balance: '145.00', at: clock.now() });
  });

  it('counts entries dated after today: the cache is not a point in time', async () => {
    sources.accounts.set('acc_1', {
      id: 'acc_1',
      activity: {
        openingBalance: '0.00',
        payments: [{ date: '2099-01-01', netCredited: '10.00', status: 'CONFIRMADO' }],
        expenses: [],
        transfersIn: [],
        transfersOut: [],
        movements: [],
      },
    });
    await projector.projectAccount('acc_1');
    expect(writer.balances.get('acc_1')?.balance).toBe('10.00');
  });

  it('skips an account that does not exist', async () => {
    await projector.projectAccount('nope');
    expect(writer.balances.size).toBe(0);
  });
});

const clientSource = (overrides: Partial<ClientMetricsSource> = {}): ClientMetricsSource => ({
  clientId: 'cli_1',
  invoices: [],
  allocations: [],
  payments: [],
  ...overrides,
});

describe('projectClient (DT-98, DT-99, DT-111)', () => {
  it('recomputes the money columns from the sources', async () => {
    sources.clients.set(
      'cli_1',
      clientSource({
        invoices: [
          {
            status: 'EMITIDA',
            isDraft: false,
            totalUsd: '100.00',
            balance: '100.00',
            usdRate: '1',
          },
          {
            status: 'VENCIDA',
            isDraft: false,
            totalUsd: '50.00',
            balance: '2000.00',
            usdRate: '40',
          },
          { status: 'PARCIAL', isDraft: false, totalUsd: '30.00', balance: '10.00', usdRate: '1' },
          { status: 'PAGADA', isDraft: false, totalUsd: '20.00', balance: '0.00', usdRate: '1' },
          {
            status: 'BORRADOR',
            isDraft: true,
            totalUsd: '900.00',
            balance: '900.00',
            usdRate: '1',
          },
          {
            status: 'ANULADA',
            isDraft: false,
            totalUsd: '800.00',
            balance: '800.00',
            usdRate: '1',
          },
        ],
        allocations: [
          { amountUsd: '70.00', paymentStatus: 'CONFIRMADO' },
          { amountUsd: '5.00', paymentStatus: 'CONFIRMADO' },
          { amountUsd: '500.00', paymentStatus: 'ANULADO' },
        ],
        payments: [
          { status: 'CONFIRMADO', unallocated: '400.00', usdRate: '40' },
          { status: 'CONFIRMADO', unallocated: '0.00', usdRate: '1' },
          { status: 'PENDIENTE_VERIFICACION', unallocated: '1000.00', usdRate: '1' },
        ],
      }),
    );
    await projector.projectClient('cli_1');
    expect(writer.clientMetrics.get('cli_1')).toMatchObject({
      invoicedUsd: '200.00',
      collectedUsd: '75.00',
      receivableUsd: '160.00',
      overdueUsd: '50.00',
      creditUsd: '10.00',
    });
  });

  it('writes zeros for a client with no finance activity', async () => {
    sources.clients.set('cli_1', clientSource());
    await projector.projectClient('cli_1');
    expect(writer.clientMetrics.get('cli_1')).toMatchObject({
      invoicedUsd: '0.00',
      collectedUsd: '0.00',
      receivableUsd: '0.00',
      overdueUsd: '0.00',
      creditUsd: '0.00',
    });
  });

  it('leaves projectCount and lastActivityAt untouched (DT-111)', async () => {
    const activity = new Date('2026-01-01T00:00:00.000Z');
    writer.clientMetrics.set('cli_1', {
      invoicedUsd: '0.00',
      collectedUsd: '0.00',
      receivableUsd: '0.00',
      overdueUsd: '0.00',
      creditUsd: '0.00',
      projectCount: 3,
      lastActivityAt: activity,
    });
    sources.clients.set(
      'cli_1',
      clientSource({
        invoices: [
          { status: 'EMITIDA', isDraft: false, totalUsd: '9.00', balance: '9.00', usdRate: '1' },
        ],
      }),
    );
    await projector.projectClient('cli_1');
    expect(writer.clientMetrics.get('cli_1')).toMatchObject({
      invoicedUsd: '9.00',
      projectCount: 3,
      lastActivityAt: activity,
    });
  });

  it('skips a client that does not exist', async () => {
    await projector.projectClient('nope');
    expect(writer.clientMetrics.size).toBe(0);
  });

  it('locks the metrics row before it reads the sources, so a concurrent writer is not lost', async () => {
    sources.clients.set('cli_1', clientSource());
    await projector.projectClient('cli_1');
    expect(log).toEqual(['lockClients:cli_1', 'read:client:cli_1', 'client:cli_1']);
  });

  it('projects several clients ascending under one lock, whatever order they come in', async () => {
    for (const id of ['cli_b', 'cli_a', 'cli_c']) {
      sources.clients.set(id, clientSource({ clientId: id }));
    }
    await projector.projectClients(['cli_c', 'cli_a', 'cli_b', 'cli_a']);
    expect(log).toEqual([
      'lockClients:cli_a,cli_b,cli_c',
      'read:client:cli_a',
      'client:cli_a',
      'read:client:cli_b',
      'client:cli_b',
      'read:client:cli_c',
      'client:cli_c',
    ]);
  });
});

const projectSource = (overrides: Partial<ProjectMetricsSource> = {}): ProjectMetricsSource => ({
  projectId: 'pry_1',
  plan: { model: 'PRECIO_FIJO', currency: 'USD', contractedUsd: '10000.00', usdRate: null },
  adjustments: [],
  lines: [],
  recurringMonthlyUsd: [],
  paidExpensesUsd: [],
  ...overrides,
});

describe('projectProject (PRD §8.4.4, computeProjectSummary)', () => {
  it('computes the summary from the stored snapshots', async () => {
    sources.projects.set(
      'pry_1',
      projectSource({
        adjustments: [{ amount: '500.00', currency: 'USD' }],
        lines: [
          {
            invoiceStatus: 'PARCIAL',
            invoiceIsDraft: false,
            netAmount: '4000.00',
            invoiceUsdRate: '40',
            invoiceReceivable: '8000.00',
            invoicePaid: '4000.00',
          },
          {
            invoiceStatus: 'EMITIDA',
            invoiceIsDraft: false,
            netAmount: '1000.00',
            invoiceUsdRate: '1',
            invoiceReceivable: '1000.00',
            invoicePaid: '0.00',
          },
        ],
        recurringMonthlyUsd: ['50.00', '25.00'],
        paidExpensesUsd: ['20.00', '5.00'],
      }),
    );
    await projector.projectProject('pry_1');
    // lines in USD: 100.00 (half collected = 50.00) and 1000.00 (0)
    expect(writer.projectMetrics.get('pry_1')).toEqual({
      contractedUsd: '10500.00',
      invoicedUsd: '1100.00',
      collectedUsd: '50.00',
      toInvoiceUsd: '9400.00',
      receivableUsd: '1050.00',
      expensesUsd: '25.00',
      marginUsd: '25.00',
      monthlyRecurringUsd: '75.00',
    });
  });

  it('ignores the lines of draft and voided invoices', async () => {
    const line = {
      netAmount: '300.00',
      invoiceUsdRate: '1',
      invoiceReceivable: '300.00',
      invoicePaid: '0.00',
    };
    sources.projects.set(
      'pry_1',
      projectSource({
        lines: [
          { ...line, invoiceStatus: 'BORRADOR', invoiceIsDraft: true },
          { ...line, invoiceStatus: 'ANULADA', invoiceIsDraft: false },
          { ...line, invoiceStatus: 'EMITIDA', invoiceIsDraft: false },
        ],
      }),
    );
    await projector.projectProject('pry_1');
    expect(writer.projectMetrics.get('pry_1')).toMatchObject({ invoicedUsd: '300.00' });
  });

  it('converts a plan-currency adjustment with the plan rate and skips one in another currency', async () => {
    sources.projects.set(
      'pry_1',
      projectSource({
        plan: { model: 'MIXTO', currency: 'VES', contractedUsd: '1000.00', usdRate: '40' },
        adjustments: [
          { amount: '400.00', currency: 'VES' },
          { amount: '-200.00', currency: 'VES' },
          { amount: '77.00', currency: 'EUR' },
          { amount: '10.00', currency: 'USD' },
        ],
      }),
    );
    await projector.projectProject('pry_1');
    // 1000 + 10 − 5 + 10
    expect(writer.projectMetrics.get('pry_1')).toMatchObject({ contractedUsd: '1015.00' });
  });

  it('counts a null contractedUsd as 0 and never lets toInvoice go below 0', async () => {
    sources.projects.set(
      'pry_1',
      projectSource({
        plan: { model: 'PRECIO_FIJO', currency: 'USD', contractedUsd: null, usdRate: null },
        lines: [
          {
            invoiceStatus: 'EMITIDA',
            invoiceIsDraft: false,
            netAmount: '200.00',
            invoiceUsdRate: '1',
            invoiceReceivable: '200.00',
            invoicePaid: '0.00',
          },
        ],
      }),
    );
    await projector.projectProject('pry_1');
    expect(writer.projectMetrics.get('pry_1')).toMatchObject({
      contractedUsd: '0.00',
      toInvoiceUsd: '0.00',
    });
  });

  it('keeps toInvoice at 0 for a recurring plan and for a project without a plan', async () => {
    sources.projects.set(
      'pry_1',
      projectSource({
        plan: { model: 'RECURRENTE', currency: 'USD', contractedUsd: '900.00', usdRate: null },
      }),
    );
    sources.projects.set('pry_2', projectSource({ projectId: 'pry_2', plan: null }));
    await projector.projectProject('pry_1');
    await projector.projectProject('pry_2');
    expect(writer.projectMetrics.get('pry_1')).toMatchObject({ toInvoiceUsd: '0.00' });
    expect(writer.projectMetrics.get('pry_2')).toMatchObject({
      contractedUsd: '0.00',
      toInvoiceUsd: '0.00',
      marginUsd: '0.00',
    });
  });

  it('skips a project that does not exist', async () => {
    await projector.projectProject('nope');
    expect(writer.projectMetrics.size).toBe(0);
  });

  it('locks ProjectMetrics ascending, after ClientMetrics when both are projected in order', async () => {
    for (const id of ['pry_b', 'pry_a']) {
      sources.projects.set(id, projectSource({ projectId: id }));
    }
    sources.clients.set('cli_1', clientSource());
    await projector.projectClients(['cli_1']);
    await projector.projectProjects(['pry_b', 'pry_a']);
    expect(log.filter((entry) => entry.startsWith('lock'))).toEqual([
      'lockClients:cli_1',
      'lockProjects:pry_a,pry_b',
    ]);
  });
});
