import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryFinanceSources,
  InMemoryReadModelWriter,
} from '../../../../test/finance/read-models/fakes';
import { FixedClock } from '../../../../test/support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../../../test/support/fakes/in-memory-row-locks';
import { InMemoryUnitOfWork } from '../../../../test/support/fakes/in-memory-unit-of-work';
import { ForbiddenError } from '../../../shared/domain/domain-error';
import { FinanceProjector } from './finance-projector';
import type { InvoiceCacheSource } from './ports/finance-sources.port';
import { RECOMPUTE_ALL_TIMEOUT_MS, RecomputeAll, SYSTEM_ACTOR } from './recompute-all';

const log: string[] = [];
let uow: InMemoryUnitOfWork;
let locks: InMemoryRowLocks;
let activity: InMemoryActivityLog;
let sources: InMemoryFinanceSources;
let writer: InMemoryReadModelWriter;
let useCase: RecomputeAll;
const clock = new FixedClock('2026-03-10T15:00:00.000Z');

beforeEach(() => {
  log.length = 0;
  uow = new InMemoryUnitOfWork();
  locks = new InMemoryRowLocks(uow);
  activity = new InMemoryActivityLog(uow);
  sources = new InMemoryFinanceSources(log);
  writer = new InMemoryReadModelWriter(log);
  useCase = new RecomputeAll(
    uow,
    locks,
    sources,
    writer,
    new FinanceProjector(sources, writer, clock),
    activity,
    clock,
  );
});

const invoiceCache = (overrides: Partial<InvoiceCacheSource> = {}): InvoiceCacheSource => ({
  id: 'inv_1',
  dueDate: '2026-04-01',
  usdRate: '40',
  ivaWithheld: '0.00',
  islrWithheld: '0.00',
  otherWithheld: '0.00',
  isDraft: false,
  voided: false,
  lines: [
    { id: 'l1', quantity: '1', unitPrice: '1000.00', discount: '100.00', ivaRate: '16' },
    { id: 'l2', quantity: '2', unitPrice: '50.00', discount: '0.00', ivaRate: null },
  ],
  taxLines: [{ ivaRate: '16', taxBase: '900.00', ivaAmount: '144.00' }],
  allocations: [],
  ...overrides,
});

const run = () => useCase.execute(SYSTEM_ACTOR);

describe('RecomputeAll authorization', () => {
  it('runs only for the SYSTEM actor', async () => {
    await expect(useCase.execute({ actorType: 'USER', userId: 'usr_1' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(useCase.execute({ actorType: 'PUBLIC', userId: null })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(log).toEqual([]);
  });

  it('runs in one Serializable unit of work and locks every row once, in the global order', async () => {
    sources.ids.clients = ['cli_b', 'cli_a'];
    sources.ids.projects = ['pry_1'];
    sources.ids.invoices = ['inv_1'];
    sources.ids.payments = ['pay_1'];
    sources.ids.expenses = ['exp_1'];
    sources.ids.accounts = ['acc_1'];
    sources.ids.installments = ['ins_1'];
    sources.ids.recurringCharges = ['rch_1'];
    sources.ids.recurringExpenses = ['rex_1'];
    await run();
    expect(uow.lastOptions).toEqual({
      isolation: 'Serializable',
      timeoutMs: RECOMPUTE_ALL_TIMEOUT_MS,
    });
    expect(locks.acquired.map((row) => row.rowClass)).toEqual([
      'Project',
      'Client',
      'Client',
      'RecurringCharge',
      'RecurringExpense',
      'BillingInstallment',
      'Invoice',
      'Payment',
      'Expense',
      'Account',
    ]);
  });
});

describe('RecomputeAll invoice caches (C17, data-rules §8)', () => {
  it('rebuilds line, tax and total caches and the payment state from the sources', async () => {
    sources.ids.invoices = ['inv_1'];
    sources.invoiceCaches.set(
      'inv_1',
      invoiceCache({
        allocations: [
          { amountInvoiceCurrency: '300.00', paymentStatus: 'CONFIRMADO' },
          { amountInvoiceCurrency: '999.00', paymentStatus: 'ANULADO' },
        ],
      }),
    );
    await run();
    expect(writer.invoiceCaches.get('inv_1')).toEqual({
      lines: [
        { id: 'l1', amount: '1000.00', netAmount: '900.00' },
        { id: 'l2', amount: '100.00', netAmount: '100.00' },
      ],
      subtotal: '1100.00',
      discount: '100.00',
      exemptAmount: '100.00',
      taxBase: '900.00',
      ivaAmount: '144.00',
      total: '1144.00',
      receivable: '1144.00',
      totalUsd: '28.60',
      receivableUsd: '28.60',
      paidAmount: '300.00',
      balance: '844.00',
      status: 'PARCIAL',
      taxLines: [{ ivaRate: '16', taxBase: '900.00', ivaAmount: '144.00' }],
    });
  });

  it('marks an unpaid invoice past its due date VENCIDA using the clock, and a settled one PAGADA', async () => {
    sources.ids.invoices = ['late', 'paid', 'void', 'draft'];
    sources.invoiceCaches.set('late', invoiceCache({ id: 'late', dueDate: '2026-03-09' }));
    sources.invoiceCaches.set(
      'paid',
      invoiceCache({
        id: 'paid',
        allocations: [{ amountInvoiceCurrency: '1144.00', paymentStatus: 'CONFIRMADO' }],
      }),
    );
    sources.invoiceCaches.set('void', invoiceCache({ id: 'void', voided: true }));
    sources.invoiceCaches.set('draft', invoiceCache({ id: 'draft', isDraft: true }));
    await run();
    expect(writer.invoiceCaches.get('late')?.status).toBe('VENCIDA');
    expect(writer.invoiceCaches.get('paid')?.status).toBe('PAGADA');
    expect(writer.invoiceCaches.get('void')?.status).toBe('ANULADA');
    expect(writer.invoiceCaches.get('draft')?.status).toBe('BORRADOR');
  });

  it('keeps a valid ±0.01 IVA adjustment while taxBase and rate are unchanged', async () => {
    sources.ids.invoices = ['inv_1'];
    sources.invoiceCaches.set(
      'inv_1',
      invoiceCache({ taxLines: [{ ivaRate: '16', taxBase: '900.00', ivaAmount: '144.01' }] }),
    );
    await run();
    const cache = writer.invoiceCaches.get('inv_1');
    expect(cache?.taxLines).toEqual([{ ivaRate: '16', taxBase: '900.00', ivaAmount: '144.01' }]);
    expect(cache?.ivaAmount).toBe('144.01');
    expect(cache?.total).toBe('1144.01');
  });

  it('resets the adjustment when the taxBase changed or it is out of range', async () => {
    sources.ids.invoices = ['moved', 'wild'];
    sources.invoiceCaches.set(
      'moved',
      invoiceCache({
        id: 'moved',
        taxLines: [{ ivaRate: '16', taxBase: '800.00', ivaAmount: '128.01' }],
      }),
    );
    sources.invoiceCaches.set(
      'wild',
      invoiceCache({
        id: 'wild',
        taxLines: [{ ivaRate: '16', taxBase: '900.00', ivaAmount: '150.00' }],
      }),
    );
    await run();
    expect(writer.invoiceCaches.get('moved')?.ivaAmount).toBe('144.00');
    expect(writer.invoiceCaches.get('wild')?.ivaAmount).toBe('144.00');
  });

  it('reports an invoice whose data cannot be recomputed and carries on with the rest', async () => {
    sources.ids.invoices = ['bad', 'good'];
    sources.invoiceCaches.set(
      'bad',
      invoiceCache({
        id: 'bad',
        lines: [{ id: 'l1', quantity: '1', unitPrice: '10.00', discount: '50.00', ivaRate: null }],
      }),
    );
    sources.invoiceCaches.set('good', invoiceCache({ id: 'good' }));
    const result = await run();
    expect(result.problems).toEqual([
      { entity: 'INVOICE', id: 'bad', reason: expect.stringContaining('discount') as string },
    ]);
    expect(writer.invoiceCaches.has('bad')).toBe(false);
    expect(writer.invoiceCaches.has('good')).toBe(true);
  });
});

describe('RecomputeAll other caches', () => {
  it('rebuilds Payment.unallocated, installment status and the recurring USD snapshots', async () => {
    sources.ids.payments = ['pay_1'];
    sources.paymentCaches.set('pay_1', {
      id: 'pay_1',
      amount: '1000.00',
      igtfAmount: '30.00',
      feeAmount: '5.00',
      allocated: ['400.00', '100.00'],
    });
    sources.ids.installments = ['ins_1', 'ins_2'];
    sources.installmentCaches.set('ins_1', {
      id: 'ins_1',
      cancelled: false,
      invoices: [
        { status: 'PAGADA', paidAmount: '10.00' },
        { status: 'ANULADA', paidAmount: '0.00' },
      ],
    });
    sources.installmentCaches.set('ins_2', { id: 'ins_2', cancelled: true, invoices: [] });
    sources.ids.recurringCharges = ['rch_1'];
    sources.chargeCaches.set('rch_1', {
      id: 'rch_1',
      amount: '1200.00',
      frequency: 'ANUAL',
      usdRate: '40',
    });
    sources.ids.recurringExpenses = ['rex_1'];
    sources.recurringExpenseCaches.set('rex_1', {
      id: 'rex_1',
      amount: '300.00',
      frequency: 'TRIMESTRAL',
      usdRate: '1',
    });
    await run();
    expect(writer.paymentCaches.get('pay_1')).toEqual({
      allocatable: '970.00',
      netCredited: '995.00',
      unallocated: '470.00',
    });
    expect(writer.installmentStatuses.get('ins_1')).toBe('COBRADA');
    expect(writer.installmentStatuses.get('ins_2')).toBe('CANCELADA');
    // 1200 / 12 = 100.00 VES a month, / 40
    expect(writer.chargeMonthly.get('rch_1')).toBe('2.50');
    expect(writer.recurringExpenseMonthly.get('rex_1')).toBe('100.00');
  });
});

describe('RecomputeAll read models', () => {
  it('clears the facts, projects every source and then the metrics, clients and projects ascending', async () => {
    sources.ids = {
      ...sources.ids,
      clients: ['cli_b', 'cli_a'],
      projects: ['pry_b', 'pry_a'],
      invoices: ['inv_1'],
      payments: ['pay_1'],
      expenses: ['exp_1'],
      transfers: ['trf_1'],
      movements: ['mov_1'],
      accounts: ['acc_1'],
    };
    writer.facts.set('INVOICE:orphan', [{ kind: 'BILLED', date: '2026-01-01', amountUsd: '1.00' }]);
    await run();
    expect(writer.facts.has('INVOICE:orphan')).toBe(false);
    expect(log.indexOf('clearFacts')).toBeLessThan(log.indexOf('facts:INVOICE:inv_1'));
    expect(log.filter((entry) => entry.startsWith('facts:'))).toEqual([
      'facts:INVOICE:inv_1',
      'facts:PAYMENT:pay_1',
      'facts:EXPENSE:exp_1',
      'facts:TRANSFER:trf_1',
      'facts:MOVEMENT:mov_1',
    ]);
    expect(log.filter((entry) => entry.startsWith('lock'))).toEqual([
      'lockClients:cli_a,cli_b',
      'lockProjects:pry_a,pry_b',
    ]);
    expect(log.indexOf('lockClients:cli_a,cli_b')).toBeLessThan(
      log.indexOf('lockProjects:pry_a,pry_b'),
    );
  });

  it('records the run as a SYSTEM_JOB activity entry with the counts', async () => {
    sources.ids.invoices = ['inv_1'];
    sources.invoiceCaches.set('inv_1', invoiceCache());
    sources.ids.clients = ['cli_1'];
    await run();
    expect(activity.entries).toEqual([
      expect.objectContaining({
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'SYSTEM_JOB',
        entityType: 'SETTING',
        entityId: 'recompute-all',
        metadata: expect.objectContaining({ invoices: 1, clients: 1, problems: 0 }) as object,
      }),
    ]);
  });
});
