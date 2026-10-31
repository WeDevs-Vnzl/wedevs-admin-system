import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorld,
  seedAccount,
  seedClient,
  seedInvoice,
  seedProject,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const world = buildWorld(service);
const { uow, writer, host, metrics } = world;

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const zeroClient = {
  invoicedUsd: '0.00',
  collectedUsd: '0.00',
  receivableUsd: '0.00',
  overdueUsd: '0.00',
  creditUsd: '0.00',
};

describe('PrismaReadModelWriter facts', () => {
  it('replaces the facts of one source and leaves the others alone', async () => {
    await writer.replaceFacts('INVOICE', 'inv_1', []).then(
      () => expect.unreachable('outside a unit of work'),
      (error: Error) => expect(error.message).toContain('unit of work'),
    );
    await uow.run(async () => {
      await writer.replaceFacts('INVOICE', 'inv_1', [
        {
          kind: 'BILLED',
          date: '2026-02-01',
          amountUsd: '60.00',
          clientId: 'cli_a',
          projectId: 'pry_a',
          invoiceId: 'inv_1',
          dueDate: '2026-03-01',
        },
        { kind: 'IVA', date: '2026-02-01', amountUsd: '9.60', invoiceId: 'inv_1', ivaRate: '16' },
      ]);
      await writer.replaceFacts('PAYMENT', 'pay_1', [
        { kind: 'IGTF', date: '2026-02-02', amountUsd: '1.00', accountId: 'acc_a', methodId: 'm' },
      ]);
    });
    await uow.run(() =>
      writer.replaceFacts('INVOICE', 'inv_1', [
        { kind: 'BILLED', date: '2026-02-01', amountUsd: '10.00' },
      ]),
    );
    const rows = await admin.financeFact.findMany({ orderBy: [{ sourceType: 'asc' }] });
    expect(rows.map((row) => [row.sourceType, row.sourceId, row.kind])).toEqual([
      ['INVOICE', 'inv_1', 'BILLED'],
      ['PAYMENT', 'pay_1', 'IGTF'],
    ]);
    expect(rows[0]).toMatchObject({
      clientId: null,
      projectId: null,
      dueDate: null,
      ivaRate: null,
    });
  });

  it('stores every column of a fact and an empty list deletes the source facts', async () => {
    await uow.run(() =>
      writer.replaceFacts('INVOICE', 'inv_1', [
        {
          kind: 'IVA',
          date: '2026-02-01',
          amountUsd: '-9.60',
          clientId: 'c',
          projectId: 'p',
          accountId: 'a',
          categoryId: 'k',
          methodId: 'm',
          invoiceId: 'i',
          ivaRate: '16.00',
          dueDate: '2026-03-01',
        },
      ]),
    );
    const row = await admin.financeFact.findFirstOrThrow();
    expect(row.amountUsd.toFixed(2)).toBe('-9.60');
    expect(row.ivaRate?.toFixed(2)).toBe('16.00');
    expect(row.date.toISOString().slice(0, 10)).toBe('2026-02-01');
    expect(row.dueDate?.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect([
      row.clientId,
      row.projectId,
      row.accountId,
      row.categoryId,
      row.methodId,
      row.invoiceId,
    ]).toEqual(['c', 'p', 'a', 'k', 'm', 'i']);
    await uow.run(() => writer.replaceFacts('INVOICE', 'inv_1', []));
    expect(await admin.financeFact.count()).toBe(0);
  });

  it('clearFacts removes every fact', async () => {
    await uow.run(async () => {
      await writer.replaceFacts('INVOICE', 'a', [
        { kind: 'BILLED', date: '2026-02-01', amountUsd: '1.00' },
      ]);
      await writer.replaceFacts('EXPENSE', 'b', [
        { kind: 'EXPENSE_PAID', date: '2026-02-01', amountUsd: '1.00' },
      ]);
      await writer.clearFacts();
    });
    expect(await admin.financeFact.count()).toBe(0);
  });
});

describe('PrismaReadModelWriter metrics (DT-111)', () => {
  it('writes only the money columns: projectCount and lastActivityAt survive', async () => {
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await metrics.setProjectCount('cli_a', 4);
      await metrics.touchActivity(['cli_a'], new Date('2026-02-20T10:00:00.000Z'));
    });
    await uow.run(() =>
      writer.writeClientMetrics('cli_a', {
        ...zeroClient,
        invoicedUsd: '120.50',
        creditUsd: '3.25',
      }),
    );
    const row = await admin.clientMetrics.findUniqueOrThrow({ where: { clientId: 'cli_a' } });
    expect(row.projectCount).toBe(4);
    expect(row.lastActivityAt?.toISOString()).toBe('2026-02-20T10:00:00.000Z');
    expect(row.invoicedUsd.toFixed(2)).toBe('120.50');
    expect(row.creditUsd.toFixed(2)).toBe('3.25');
    await uow.run(() => writer.writeClientMetrics('cli_a', zeroClient));
    const again = await admin.clientMetrics.findUniqueOrThrow({ where: { clientId: 'cli_a' } });
    expect(again.invoicedUsd.toFixed(2)).toBe('0.00');
    expect(again.projectCount).toBe(4);
  });

  it('creates the row when the client has none yet, with projectCount at its default', async () => {
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await writer.writeClientMetrics('cli_a', { ...zeroClient, receivableUsd: '5.00' });
    });
    const row = await admin.clientMetrics.findUniqueOrThrow({ where: { clientId: 'cli_a' } });
    expect([row.projectCount, row.lastActivityAt, row.receivableUsd.toFixed(2)]).toEqual([
      0,
      null,
      '5.00',
    ]);
  });

  it('locks create the rows of existing clients and projects and skip unknown ids', async () => {
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await seedProject(host.db, 'pry_a', ['cli_a']);
      await writer.lockClientMetrics(['cli_a', 'nobody', 'cli_a']);
      await writer.lockProjectMetrics(['pry_a', 'nothing']);
      await writer.lockClientMetrics([]);
    });
    expect((await admin.clientMetrics.findMany()).map((row) => row.clientId)).toEqual(['cli_a']);
    expect((await admin.projectMetrics.findMany()).map((row) => row.projectId)).toEqual(['pry_a']);
  });

  it('writes the project money columns', async () => {
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await seedProject(host.db, 'pry_a', ['cli_a']);
      await writer.writeProjectMetrics('pry_a', {
        contractedUsd: '10500.00',
        invoicedUsd: '1100.00',
        collectedUsd: '50.00',
        toInvoiceUsd: '9400.00',
        receivableUsd: '1050.00',
        expensesUsd: '25.00',
        marginUsd: '25.00',
        monthlyRecurringUsd: '75.00',
      });
      await writer.writeProjectMetrics('pry_a', {
        contractedUsd: '1.00',
        invoicedUsd: '0.00',
        collectedUsd: '0.00',
        toInvoiceUsd: '1.00',
        receivableUsd: '0.00',
        expensesUsd: '0.00',
        marginUsd: '0.00',
        monthlyRecurringUsd: '0.00',
      });
    });
    const row = await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_a' } });
    expect([row.contractedUsd.toFixed(2), row.toInvoiceUsd.toFixed(2)]).toEqual(['1.00', '1.00']);
  });
});

describe('PrismaReadModelWriter caches', () => {
  it('writes the account balance and instant', async () => {
    const at = new Date('2026-03-10T15:00:00.000Z');
    await uow.run(async () => {
      await seedAccount(host.db, 'acc_a');
      await writer.writeAccountBalance('acc_a', '145.00', at);
    });
    const row = await admin.account.findUniqueOrThrow({ where: { id: 'acc_a' } });
    expect([row.balance.toFixed(2), row.balanceAt?.toISOString()]).toEqual([
      '145.00',
      at.toISOString(),
    ]);
  });

  it('writes the invoice cache and replaces its tax lines', async () => {
    await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        lines: [{ id: 'l1', projectId: null, unitPrice: '100.00', ivaRate: '16' }],
      });
      await writer.writeInvoiceCache('inv_1', {
        lines: [{ id: 'l1', amount: '100.00', netAmount: '95.00' }],
        subtotal: '100.00',
        discount: '5.00',
        exemptAmount: '0.00',
        taxBase: '95.00',
        ivaAmount: '15.21',
        total: '110.21',
        receivable: '110.21',
        totalUsd: '110.21',
        receivableUsd: '110.21',
        paidAmount: '10.00',
        balance: '100.21',
        status: 'PARCIAL',
        taxLines: [{ ivaRate: '16', taxBase: '95.00', ivaAmount: '15.21' }],
      });
    });
    const invoice = await admin.invoice.findUniqueOrThrow({
      where: { id: 'inv_1' },
      include: { taxLines: true, lines: true },
    });
    expect([invoice.total.toFixed(2), invoice.balance.toFixed(2), invoice.status]).toEqual([
      '110.21',
      '100.21',
      'PARCIAL',
    ]);
    expect(invoice.lines[0]?.netAmount.toFixed(2)).toBe('95.00');
    expect(invoice.taxLines.map((line) => line.ivaAmount.toFixed(2))).toEqual(['15.21']);
  });

  it('writes the payment cache, installment status and recurring snapshots', async () => {
    const ids = await uow.run(async () => {
      await seedClient(host.db, 'cli_a');
      await seedProject(host.db, 'pry_a', ['cli_a']);
      await seedAccount(host.db, 'acc_a');
      const method = await host.db.paymentMethod.findFirstOrThrow();
      const category = await host.db.expenseCategory.findFirstOrThrow();
      await host.db.payment.create({
        data: {
          id: 'pay_1',
          code: 'PAG-1',
          clientId: 'cli_a',
          date: new Date('2026-02-01'),
          accountId: 'acc_a',
          methodId: method.id,
          currency: 'USD',
          amount: '100',
          netCredited: '100',
          allocatable: '100',
          unallocated: '100',
          usdRate: '1',
          amountUsd: '100',
        },
      });
      await host.db.billingInstallment.create({
        data: {
          id: 'ins_1',
          projectId: 'pry_a',
          kind: 'HITO',
          label: 'x',
          amount: '10',
          currency: 'USD',
        },
      });
      await host.db.recurringCharge.create({
        data: {
          id: 'rch_1',
          projectId: 'pry_a',
          label: 'x',
          amount: '120',
          currency: 'USD',
          frequency: 'ANUAL',
          startDate: new Date('2026-01-01'),
          billingDay: 1,
          usdRate: '1',
          monthlyAmountUsd: '0',
        },
      });
      await host.db.recurringExpense.create({
        data: {
          id: 'rex_1',
          name: 'x',
          categoryId: category.id,
          currency: 'USD',
          amount: '120',
          frequency: 'ANUAL',
          dayOfPeriod: 1,
          startDate: new Date('2026-01-01'),
          usdRate: '1',
          monthlyAmountUsd: '0',
        },
      });
      await writer.writePaymentCache('pay_1', {
        allocatable: '90.00',
        netCredited: '95.00',
        unallocated: '40.00',
      });
      await writer.writeInstallmentStatus('ins_1', 'FACTURADA');
      await writer.writeRecurringChargeMonthlyUsd('rch_1', '10.00');
      await writer.writeRecurringExpenseMonthlyUsd('rex_1', '10.00');
      return true;
    });
    expect(ids).toBe(true);
    const payment = await admin.payment.findUniqueOrThrow({ where: { id: 'pay_1' } });
    expect(
      [payment.allocatable, payment.netCredited, payment.unallocated].map((v) => v.toFixed(2)),
    ).toEqual(['90.00', '95.00', '40.00']);
    expect(
      (await admin.billingInstallment.findUniqueOrThrow({ where: { id: 'ins_1' } })).status,
    ).toBe('FACTURADA');
    expect(
      (
        await admin.recurringCharge.findUniqueOrThrow({ where: { id: 'rch_1' } })
      ).monthlyAmountUsd.toFixed(2),
    ).toBe('10.00');
    expect(
      (
        await admin.recurringExpense.findUniqueOrThrow({ where: { id: 'rex_1' } })
      ).monthlyAmountUsd.toFixed(2),
    ).toBe('10.00');
  });
});
