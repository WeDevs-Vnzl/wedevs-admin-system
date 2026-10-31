import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWorld,
  catalogIds,
  seedAccount,
  seedClient,
  seedExpense,
  seedInvoice,
  seedPayment,
  seedProject,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const { uow, sources, host } = buildWorld(service);

beforeAll(() => truncateBusinessTables(admin), 60_000);
beforeEach(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

/** Reads happen inside a unit of work, like the projector's. */
const read = <T>(work: () => Promise<T>) => uow.run(work);

async function base() {
  await seedClient(host.db, 'cli_a');
  await seedProject(host.db, 'pry_a', ['cli_a']);
  await seedProject(host.db, 'pry_b', ['cli_a']);
  await seedAccount(host.db, 'acc_a', 'USD', '100.00');
  return catalogIds(host.db);
}

describe('PrismaFinanceSources facts', () => {
  it('answers null for ids that do not exist', async () => {
    const answers = await read(async () => {
      const found: unknown[] = [];
      for (const query of [
        () => sources.invoiceFacts('x'),
        () => sources.paymentFacts('x'),
        () => sources.expenseFacts('x'),
        () => sources.transferFacts('x'),
        () => sources.movementFacts('x'),
        () => sources.accountSource('x'),
        () => sources.clientMetricsSource('x'),
        () => sources.projectMetricsSource('x'),
        () => sources.invoiceCache('x'),
        () => sources.paymentCache('x'),
        () => sources.installmentCache('x'),
        () => sources.recurringChargeCache('x'),
        () => sources.recurringExpenseCache('x'),
      ]) {
        found.push(await query());
      }
      return found;
    });
    expect(answers.every((answer) => answer === null)).toBe(true);
  });

  it('reads an invoice with its lines in order, tax lines and archived flag, decimals as plain strings', async () => {
    const source = await read(async () => {
      await base();
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        usdRate: '0.00000001',
        ivaWithheld: '0.00',
        archived: true,
        lines: [
          { id: 'l2', projectId: 'pry_b', unitPrice: '40.00', ivaRate: null },
          { id: 'l1', projectId: 'pry_a', unitPrice: '60.00', ivaRate: '16' },
        ],
      });
      return sources.invoiceFacts('inv_1');
    });
    expect(source).toMatchObject({
      id: 'inv_1',
      clientId: 'cli_a',
      status: 'EMITIDA',
      isDraft: false,
      archived: true,
      issueDate: '2026-02-01',
      usdRate: '0.00000001',
      lines: [
        { projectId: 'pry_b', netAmount: '40' },
        { projectId: 'pry_a', netAmount: '60' },
      ],
      taxLines: [{ ivaRate: '16', ivaAmount: '9.6' }],
    });
  });

  it('reads a payment with its live allocations and the lines of their invoices', async () => {
    const source = await read(async () => {
      const { methodId } = await base();
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        lines: [
          { id: 'l1', projectId: 'pry_a', unitPrice: '75.00', ivaRate: null },
          { id: 'l2', projectId: 'pry_b', unitPrice: '25.00', ivaRate: null },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_1',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '100.00',
        igtfAmount: '3.00',
        allocations: [
          {
            id: 'al_1',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '50.00',
            amountInvoiceCurrency: '50.00',
            amountUsd: '50.00',
          },
          {
            id: 'al_2',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '9.00',
            amountInvoiceCurrency: '9.00',
            amountUsd: '9.00',
            deleted: true,
          },
        ],
      });
      return sources.paymentFacts('pay_1');
    });
    expect(source).toMatchObject({
      id: 'pay_1',
      status: 'CONFIRMADO',
      archived: false,
      igtfAmount: '3',
      allocations: [
        {
          invoiceId: 'inv_1',
          amountUsd: '50',
          invoiceLines: [
            { projectId: 'pry_a', netAmount: '75' },
            { projectId: 'pry_b', netAmount: '25' },
          ],
        },
      ],
    });
  });

  it('reads an expense dated by its paid date, a transfer and a movement', async () => {
    const result = await read(async () => {
      const { categoryId } = await base();
      await seedAccount(host.db, 'acc_b');
      await seedExpense(host.db, {
        id: 'exp_1',
        categoryId,
        amount: '25.00',
        accountId: 'acc_a',
        projectId: 'pry_a',
        paidAt: '2026-02-20',
      });
      await seedExpense(host.db, { id: 'exp_2', categoryId, amount: '5.00', status: 'PENDIENTE' });
      await host.db.accountTransfer.create({
        data: {
          id: 'trf_1',
          date: new Date('2026-02-05'),
          fromAccountId: 'acc_a',
          toAccountId: 'acc_b',
          amountFrom: '10',
          amountTo: '10',
          amountUsd: '10',
        },
      });
      await host.db.accountMovement.create({
        data: {
          id: 'mov_1',
          accountId: 'acc_a',
          type: 'AJUSTE',
          date: new Date('2026-02-06'),
          amount: '-2',
          amountUsd: '-2',
          description: 'x',
        },
      });
      return {
        paid: await sources.expenseFacts('exp_1'),
        pending: await sources.expenseFacts('exp_2'),
        transfer: await sources.transferFacts('trf_1'),
        movement: await sources.movementFacts('mov_1'),
      };
    });
    expect(result.paid).toMatchObject({
      status: 'PAGADO',
      paidDate: '2026-02-20',
      accountId: 'acc_a',
      projectId: 'pry_a',
      amountUsd: '25',
    });
    expect(result.pending).toMatchObject({
      status: 'PENDIENTE',
      paidDate: '2026-02-15',
      accountId: null,
    });
    expect(result.transfer).toMatchObject({
      fromAccountId: 'acc_a',
      toAccountId: 'acc_b',
      amountUsd: '10',
      archived: false,
    });
    expect(result.movement).toMatchObject({ type: 'AJUSTE', amountUsd: '-2', accountId: 'acc_a' });
  });

  it('reads an account with everything that moves its balance', async () => {
    const source = await read(async () => {
      const { methodId, categoryId } = await base();
      await seedAccount(host.db, 'acc_b');
      await seedPayment(host.db, {
        id: 'pay_1',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '50.00',
        feeAmount: '1.00',
      });
      await seedExpense(host.db, {
        id: 'exp_1',
        categoryId,
        amount: '30.00',
        accountId: 'acc_a',
        accountAmount: '12.00',
        paidAt: '2026-02-03',
      });
      await host.db.accountTransfer.create({
        data: {
          id: 'trf_1',
          date: new Date('2026-02-04'),
          fromAccountId: 'acc_a',
          toAccountId: 'acc_b',
          amountFrom: '5',
          amountTo: '5',
          feeAmount: '1',
          amountUsd: '5',
        },
      });
      await host.db.accountMovement.create({
        data: {
          id: 'mov_1',
          accountId: 'acc_a',
          type: 'RETIRO_SOCIO',
          date: new Date('2026-02-06'),
          amount: '15',
          amountUsd: '15',
          description: 'x',
        },
      });
      await host.db.accountMovement.create({
        data: {
          id: 'mov_2',
          accountId: 'acc_a',
          type: 'APORTE_CAPITAL',
          date: new Date('2026-02-06'),
          amount: '40',
          amountUsd: '40',
          description: 'x',
          deletedAt: new Date(),
        },
      });
      return sources.accountSource('acc_a');
    });
    expect(source?.activity).toEqual({
      openingBalance: '100',
      payments: [{ date: '2026-02-10', netCredited: '49', status: 'CONFIRMADO' }],
      expenses: [{ date: '2026-02-03', amount: '30', accountAmount: '12', status: 'PAGADO' }],
      transfersIn: [],
      transfersOut: [{ date: '2026-02-04', amountFrom: '5', feeAmount: '1' }],
      movements: [{ date: '2026-02-06', type: 'RETIRO_SOCIO', amount: '15' }],
    });
  });
});

describe('PrismaFinanceSources metrics sources', () => {
  it('reads the live invoices, allocations and payments of a client', async () => {
    const source = await read(async () => {
      const { methodId } = await base();
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        lines: [{ id: 'l1', projectId: 'pry_a', unitPrice: '100.00', ivaRate: null }],
      });
      await seedInvoice(host.db, {
        id: 'inv_old',
        clientId: 'cli_a',
        archived: true,
        lines: [{ id: 'l9', projectId: 'pry_a', unitPrice: '9.00', ivaRate: null }],
      });
      await seedPayment(host.db, {
        id: 'pay_1',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '100.00',
        allocations: [
          {
            id: 'al_1',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '60.00',
            amountInvoiceCurrency: '60.00',
            amountUsd: '60.00',
          },
          {
            id: 'al_2',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '1.00',
            amountInvoiceCurrency: '1.00',
            amountUsd: '1.00',
            deleted: true,
          },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_old',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '7.00',
        archived: true,
        allocations: [
          {
            id: 'al_3',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '7.00',
            amountInvoiceCurrency: '7.00',
            amountUsd: '7.00',
          },
        ],
      });
      return sources.clientMetricsSource('cli_a');
    });
    expect(source?.invoices).toEqual([
      { status: 'EMITIDA', isDraft: false, totalUsd: '100', balance: '100', usdRate: '1' },
    ]);
    expect(source?.allocations).toEqual([{ amountUsd: '60', paymentStatus: 'CONFIRMADO' }]);
    expect(source?.payments).toEqual([{ status: 'CONFIRMADO', unallocated: '40', usdRate: '1' }]);
  });

  it('reads the plan, adjustments, lines, recurring charges and paid expenses of a project', async () => {
    const source = await read(async () => {
      const { categoryId } = await base();
      await host.db.billingPlan.create({
        data: {
          id: 'plan_1',
          projectId: 'pry_a',
          model: 'MIXTO',
          currency: 'VES',
          contractAmount: '40000',
          contractedUsd: '1000',
          usdRate: '40',
        },
      });
      await host.db.billingInstallment.createMany({
        data: [
          {
            id: 'ins_adj',
            projectId: 'pry_a',
            billingPlanId: 'plan_1',
            kind: 'AJUSTE',
            label: 'a',
            amount: '400',
            currency: 'VES',
          },
          {
            id: 'ins_cancelled',
            projectId: 'pry_a',
            billingPlanId: 'plan_1',
            kind: 'AJUSTE',
            label: 'b',
            amount: '5',
            currency: 'VES',
            cancelledAt: new Date(),
          },
          {
            id: 'ins_hito',
            projectId: 'pry_a',
            billingPlanId: 'plan_1',
            kind: 'HITO',
            label: 'c',
            amount: '9',
            currency: 'VES',
          },
        ],
      });
      await host.db.recurringCharge.createMany({
        data: [
          {
            id: 'rch_on',
            projectId: 'pry_a',
            label: 'x',
            amount: '10',
            currency: 'USD',
            frequency: 'MENSUAL',
            startDate: new Date('2026-01-01'),
            billingDay: 1,
            usdRate: '1',
            monthlyAmountUsd: '10',
          },
          {
            id: 'rch_off',
            projectId: 'pry_a',
            label: 'y',
            amount: '10',
            currency: 'USD',
            frequency: 'MENSUAL',
            startDate: new Date('2026-01-01'),
            billingDay: 1,
            usdRate: '1',
            monthlyAmountUsd: '99',
            status: 'PAUSADO',
          },
        ],
      });
      await seedExpense(host.db, { id: 'exp_1', categoryId, amount: '20.00', projectId: 'pry_a' });
      await seedExpense(host.db, {
        id: 'exp_2',
        categoryId,
        amount: '8.00',
        projectId: 'pry_a',
        status: 'PENDIENTE',
      });
      await seedExpense(host.db, {
        id: 'exp_3',
        categoryId,
        amount: '6.00',
        projectId: 'pry_a',
        archived: true,
      });
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        usdRate: '40',
        currency: 'VES',
        lines: [{ id: 'l1', projectId: 'pry_a', unitPrice: '4000.00', ivaRate: null }],
      });
      await seedInvoice(host.db, {
        id: 'inv_old',
        clientId: 'cli_a',
        archived: true,
        lines: [{ id: 'l9', projectId: 'pry_a', unitPrice: '9.00', ivaRate: null }],
      });
      await seedInvoice(host.db, {
        id: 'inv_draft',
        clientId: 'cli_a',
        status: 'BORRADOR',
        lines: [{ id: 'l8', projectId: 'pry_a', unitPrice: '8.00', ivaRate: null }],
      });
      return sources.projectMetricsSource('pry_a');
    });
    expect(source).toMatchObject({
      plan: { model: 'MIXTO', currency: 'VES', contractedUsd: '1000', usdRate: '40' },
      adjustments: [{ amount: '400', currency: 'VES' }],
      recurringMonthlyUsd: ['10'],
      paidExpensesUsd: ['20'],
    });
    // The archived invoice is out; the draft is returned flagged (the projector skips it).
    expect(source?.lines.map((line) => [line.netAmount, line.invoiceIsDraft])).toEqual([
      ['4000', false],
      ['8', true],
    ]);
  });
});

describe('PrismaFinanceSources caches and ids', () => {
  it('reads the invoice cache with live allocations of live payments only', async () => {
    const source = await read(async () => {
      const { methodId } = await base();
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        status: 'ANULADA',
        lines: [{ id: 'l1', projectId: null, unitPrice: '100.00', ivaRate: '16' }],
      });
      await seedPayment(host.db, {
        id: 'pay_1',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '100.00',
        status: 'ANULADO',
        allocations: [
          {
            id: 'al_1',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '60.00',
            amountInvoiceCurrency: '60.00',
            amountUsd: '60.00',
          },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_gone',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '5.00',
        archived: true,
        allocations: [
          {
            id: 'al_2',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '5.00',
            amountInvoiceCurrency: '5.00',
            amountUsd: '5.00',
          },
        ],
      });
      return sources.invoiceCache('inv_1');
    });
    expect(source).toMatchObject({
      id: 'inv_1',
      voided: true,
      isDraft: false,
      lines: [{ id: 'l1', quantity: '1', unitPrice: '100', discount: '0', ivaRate: '16' }],
      taxLines: [{ ivaRate: '16', taxBase: '100', ivaAmount: '16' }],
      allocations: [{ amountInvoiceCurrency: '60', paymentStatus: 'ANULADO' }],
    });
  });

  it('reads payment, installment and recurring caches', async () => {
    const result = await read(async () => {
      const { methodId, categoryId } = await base();
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
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        lines: [
          {
            id: 'l1',
            projectId: 'pry_a',
            unitPrice: '10.00',
            ivaRate: null,
            installmentId: 'ins_1',
          },
        ],
      });
      await seedInvoice(host.db, {
        id: 'inv_old',
        clientId: 'cli_a',
        archived: true,
        lines: [
          {
            id: 'l2',
            projectId: 'pry_a',
            unitPrice: '10.00',
            ivaRate: null,
            installmentId: 'ins_1',
          },
        ],
      });
      await seedPayment(host.db, {
        id: 'pay_1',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '100.00',
        igtfAmount: '3.00',
        feeAmount: '1.00',
        allocations: [
          {
            id: 'al_1',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '10.00',
            amountInvoiceCurrency: '10.00',
            amountUsd: '10.00',
          },
        ],
      });
      await host.db.recurringExpense.create({
        data: {
          id: 'rex_1',
          name: 'x',
          categoryId,
          currency: 'VES',
          amount: '300',
          frequency: 'TRIMESTRAL',
          dayOfPeriod: 1,
          startDate: new Date('2026-01-01'),
          usdRate: '40',
          monthlyAmountUsd: '0',
          deletedAt: new Date(),
        },
      });
      return {
        payment: await sources.paymentCache('pay_1'),
        installment: await sources.installmentCache('ins_1'),
        recurring: await sources.recurringExpenseCache('rex_1'),
      };
    });
    expect(result.payment).toEqual({
      id: 'pay_1',
      amount: '100',
      igtfAmount: '3',
      feeAmount: '1',
      allocated: ['10'],
    });
    expect(result.installment).toEqual({
      id: 'ins_1',
      cancelled: false,
      invoices: [{ status: 'EMITIDA', paidAmount: '0' }],
    });
    expect(result.recurring).toEqual({
      id: 'rex_1',
      amount: '300',
      frequency: 'TRIMESTRAL',
      usdRate: '40',
    });
  });

  it('lists every id, archived rows included', async () => {
    const ids = await read(async () => {
      const { methodId } = await base();
      await seedInvoice(host.db, { id: 'inv_old', clientId: 'cli_a', archived: true, lines: [] });
      await seedPayment(host.db, {
        id: 'pay_old',
        clientId: 'cli_a',
        accountId: 'acc_a',
        methodId,
        amount: '1.00',
        archived: true,
      });
      await host.db.client.update({ where: { id: 'cli_a' }, data: { deletedAt: new Date() } });
      return sources.allIds();
    });
    expect(ids.clients).toEqual(['cli_a']);
    expect(ids.projects).toEqual(['pry_a', 'pry_b']);
    expect(ids.invoices).toEqual(['inv_old']);
    expect(ids.payments).toEqual(['pay_old']);
    expect(ids.accounts).toEqual(['acc_a']);
    expect(ids.expenses).toEqual([]);
  });
});
