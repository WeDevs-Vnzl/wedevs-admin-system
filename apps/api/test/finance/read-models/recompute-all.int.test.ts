import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRecomputeAll } from '../../../scripts/recompute-all';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { stringToDecimal as dec } from '../../../src/shared/infrastructure/prisma/decimal-mapper';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildWorld,
  catalogIds,
  seedAccount,
  seedClient,
  seedExpense,
  seedInvoice,
  seedPayment,
  seedProject,
  type World,
} from './world';

/**
 * `recompute-all` equals the incremental state after each mutation of a seeded scenario (BE-3 header,
 * Q-BE3-7). Each step writes sources and projects like a money use case will; then the whole state is
 * snapshotted, rebuilt from scratch by `RecomputeAll` and snapshotted again.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const clock = new FixedClock('2026-03-10T15:00:00.000Z');
const world = buildWorld(service, { clock });
const { uow, host, projector } = world;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const money = (value: { toFixed(digits?: number): string } | null | undefined) =>
  value === null || value === undefined ? null : value.toFixed(2);

async function snapshot() {
  const facts = (await admin.financeFact.findMany()).map((fact) =>
    JSON.stringify([
      fact.sourceType,
      fact.sourceId,
      fact.kind,
      fact.date.toISOString().slice(0, 10),
      money(fact.amountUsd),
      fact.clientId,
      fact.projectId,
      fact.accountId,
      fact.categoryId,
      fact.methodId,
      fact.invoiceId,
      money(fact.ivaRate),
      fact.dueDate?.toISOString().slice(0, 10) ?? null,
    ]),
  );
  const invoices = await admin.invoice.findMany({
    orderBy: { id: 'asc' },
    include: { lines: { orderBy: { id: 'asc' } }, taxLines: { orderBy: { ivaRate: 'asc' } } },
  });
  return {
    facts: facts.sort(),
    clients: (await admin.clientMetrics.findMany({ orderBy: { clientId: 'asc' } })).map((row) => ({
      id: row.clientId,
      invoiced: money(row.invoicedUsd),
      collected: money(row.collectedUsd),
      receivable: money(row.receivableUsd),
      overdue: money(row.overdueUsd),
      credit: money(row.creditUsd),
    })),
    projects: (await admin.projectMetrics.findMany({ orderBy: { projectId: 'asc' } })).map(
      (row) => ({
        id: row.projectId,
        contracted: money(row.contractedUsd),
        invoiced: money(row.invoicedUsd),
        collected: money(row.collectedUsd),
        toInvoice: money(row.toInvoiceUsd),
        receivable: money(row.receivableUsd),
        expenses: money(row.expensesUsd),
        margin: money(row.marginUsd),
        recurring: money(row.monthlyRecurringUsd),
      }),
    ),
    accounts: (await admin.account.findMany({ orderBy: { id: 'asc' } })).map((row) => [
      row.id,
      money(row.balance),
    ]),
    invoices: invoices.map((row) => ({
      id: row.id,
      money: [
        row.subtotal,
        row.discount,
        row.exemptAmount,
        row.taxBase,
        row.ivaAmount,
        row.total,
        row.receivable,
        row.totalUsd,
        row.receivableUsd,
        row.paidAmount,
        row.balance,
      ].map(money),
      status: row.status,
      lines: row.lines.map((line) => [line.id, money(line.amount), money(line.netAmount)]),
      taxLines: row.taxLines.map((line) => [
        money(line.ivaRate),
        money(line.taxBase),
        money(line.ivaAmount),
      ]),
    })),
    payments: (await admin.payment.findMany({ orderBy: { id: 'asc' } })).map((row) => [
      row.id,
      money(row.allocatable),
      money(row.netCredited),
      money(row.unallocated),
    ]),
    installments: (await admin.billingInstallment.findMany({ orderBy: { id: 'asc' } })).map(
      (row) => [row.id, row.status],
    ),
    recurring: [
      ...(await admin.recurringCharge.findMany({ orderBy: { id: 'asc' } })).map((row) => [
        row.id,
        money(row.monthlyAmountUsd),
      ]),
      ...(await admin.recurringExpense.findMany({ orderBy: { id: 'asc' } })).map((row) => [
        row.id,
        money(row.monthlyAmountUsd),
      ]),
    ],
  };
}

type Touched = {
  invoices?: string[];
  payments?: string[];
  expenses?: string[];
  transfers?: string[];
  movements?: string[];
  accounts?: string[];
  clients?: string[];
  projects?: string[];
};

/** Projects in the documented order: facts, accounts, then ClientMetrics, then ProjectMetrics. */
async function project(p: World['projector'], touched: Touched) {
  for (const id of touched.invoices ?? []) await p.projectInvoice(id);
  for (const id of touched.payments ?? []) await p.projectPayment(id);
  for (const id of touched.expenses ?? []) await p.projectExpense(id);
  for (const id of touched.transfers ?? []) await p.projectTransfer(id);
  for (const id of touched.movements ?? []) await p.projectMovement(id);
  for (const id of touched.accounts ?? []) await p.projectAccount(id);
  await p.projectClients(touched.clients ?? []);
  await p.projectProjects(touched.projects ?? []);
}

/** Runs a step as one mutation, then checks the rebuilt state equals the incremental one. */
async function step(work: () => Promise<Touched>) {
  await uow.run(async () => project(projector, await work()), { isolation: 'Serializable' });
  const incremental = await snapshot();
  await world.recomputeAll.execute(SYSTEM_ACTOR);
  expect(await snapshot()).toEqual(incremental);
  return incremental;
}

describe('recompute-all equals the incremental state after each mutation', () => {
  let methodId = '';
  let categoryId = '';

  it('0 - a seeded base: clients, projects, accounts, plans and recurring snapshots', async () => {
    const state = await step(async () => {
      ({ methodId, categoryId } = await catalogIds(host.db));
      await seedClient(host.db, 'cli_a');
      await seedClient(host.db, 'cli_b');
      await seedProject(host.db, 'pry_a', ['cli_a']);
      await seedProject(host.db, 'pry_b', ['cli_a']);
      await seedAccount(host.db, 'acc_usd', 'USD', '100.00');
      await seedAccount(host.db, 'acc_ves', 'VES', '0.00');
      await host.db.billingPlan.create({
        data: {
          id: 'plan_a',
          projectId: 'pry_a',
          model: 'PRECIO_FIJO',
          currency: 'USD',
          contractAmount: dec('10000'),
          contractedUsd: dec('10000'),
        },
      });
      await host.db.billingPlan.create({
        data: {
          id: 'plan_b',
          projectId: 'pry_b',
          model: 'MIXTO',
          currency: 'VES',
          contractAmount: dec('40000'),
          contractedUsd: dec('1000'),
          usdRate: dec('40'),
        },
      });
      await host.db.billingInstallment.createMany({
        data: [
          {
            id: 'ins_1',
            projectId: 'pry_a',
            billingPlanId: 'plan_a',
            kind: 'HITO',
            label: 'h',
            amount: dec('1096'),
            currency: 'USD',
          },
          {
            id: 'ins_adj',
            projectId: 'pry_a',
            billingPlanId: 'plan_a',
            kind: 'AJUSTE',
            label: 'a',
            amount: dec('500'),
            currency: 'USD',
          },
          {
            id: 'ins_adj_ves',
            projectId: 'pry_b',
            billingPlanId: 'plan_b',
            kind: 'AJUSTE',
            label: 'v',
            amount: dec('-400'),
            currency: 'VES',
          },
        ],
      });
      await host.db.recurringCharge.create({
        data: {
          id: 'rch_1',
          projectId: 'pry_b',
          label: 'hosting',
          amount: dec('400'),
          currency: 'VES',
          frequency: 'MENSUAL',
          startDate: new Date('2026-01-01'),
          billingDay: 1,
          usdRate: dec('40'),
          monthlyAmountUsd: dec('10'),
        },
      });
      await host.db.recurringExpense.create({
        data: {
          id: 'rex_1',
          name: 'tools',
          categoryId,
          currency: 'USD',
          amount: dec('1200'),
          frequency: 'ANUAL',
          dayOfPeriod: 1,
          startDate: new Date('2026-01-01'),
          usdRate: dec('1'),
          monthlyAmountUsd: dec('100'),
        },
      });
      return {
        clients: ['cli_a', 'cli_b'],
        projects: ['pry_a', 'pry_b'],
        accounts: ['acc_usd', 'acc_ves'],
      };
    });
    expect(state.projects).toEqual([
      expect.objectContaining({ id: 'pry_a', contracted: '10500.00', toInvoice: '10500.00' }),
      // 1000 + (-400 / 40) and the 10.00 monthly of the charge
      expect.objectContaining({ id: 'pry_b', contracted: '990.00', recurring: '10.00' }),
    ]);
    expect(state.accounts).toEqual([
      ['acc_usd', '100.00'],
      ['acc_ves', '0.00'],
    ]);
  });

  it('1 - an overdue invoice splits BILLED per project line and feeds the client', async () => {
    const state = await step(async () => {
      await seedInvoice(host.db, {
        id: 'inv_1',
        clientId: 'cli_a',
        dueDate: '2026-03-01',
        status: 'VENCIDA',
        lines: [
          {
            id: 'inv_1_a',
            projectId: 'pry_a',
            unitPrice: '600.00',
            ivaRate: '16',
            installmentId: 'ins_1',
          },
          { id: 'inv_1_b', projectId: 'pry_b', unitPrice: '400.00', ivaRate: null },
        ],
      });
      await host.db.billingInstallment.update({
        where: { id: 'ins_1' },
        data: { status: 'FACTURADA' },
      });
      return { invoices: ['inv_1'], clients: ['cli_a'], projects: ['pry_a', 'pry_b'] };
    });
    expect(state.clients[0]).toMatchObject({
      id: 'cli_a',
      invoiced: '1096.00',
      receivable: '1096.00',
      overdue: '1096.00',
    });
    const billed = state.facts
      .map((f) => JSON.parse(f) as string[])
      .filter((f) => f[2] === 'BILLED');
    expect(billed.map((f) => [f[6], f[4]])).toEqual(
      // totalUsd 1096.00 split by line netAmount 600 / 400 (Q-BE3-7), whichever the IVA of the line
      expect.arrayContaining([
        ['pry_a', '657.60'],
        ['pry_b', '438.40'],
      ]),
    );
  });

  it('2 - a payment collects by allocation and moves the account balance', async () => {
    const state = await step(async () => {
      await seedPayment(host.db, {
        id: 'pay_1',
        clientId: 'cli_a',
        accountId: 'acc_usd',
        methodId,
        amount: '500.00',
        allocations: [
          {
            id: 'al_1',
            invoiceId: 'inv_1',
            amountPaymentCurrency: '500.00',
            amountInvoiceCurrency: '500.00',
            amountUsd: '500.00',
          },
        ],
      });
      await host.db.invoice.update({
        where: { id: 'inv_1' },
        data: { paidAmount: dec('500'), balance: dec('596') },
      });
      await host.db.billingInstallment.update({
        where: { id: 'ins_1' },
        data: { status: 'COBRADA_PARCIAL' },
      });
      return {
        payments: ['pay_1'],
        accounts: ['acc_usd'],
        clients: ['cli_a'],
        projects: ['pry_a', 'pry_b'],
      };
    });
    expect(state.accounts[0]).toEqual(['acc_usd', '600.00']);
    expect(state.clients[0]).toMatchObject({
      collected: '500.00',
      receivable: '596.00',
      overdue: '596.00',
    });
  });

  it('3 - a foreign-currency invoice and payment use their own snapshot rates, with IGTF, fee and credit', async () => {
    const state = await step(async () => {
      await seedInvoice(host.db, {
        id: 'inv_2',
        clientId: 'cli_a',
        currency: 'VES',
        usdRate: '40',
        lines: [{ id: 'inv_2_a', projectId: 'pry_b', unitPrice: '4000.00', ivaRate: null }],
      });
      await seedPayment(host.db, {
        id: 'pay_2',
        clientId: 'cli_a',
        accountId: 'acc_ves',
        methodId,
        amount: '2000.00',
        currency: 'VES',
        usdRate: '40',
        igtfAmount: '60.00',
        feeAmount: '20.00',
        allocations: [
          {
            id: 'al_2',
            invoiceId: 'inv_2',
            amountPaymentCurrency: '1000.00',
            amountInvoiceCurrency: '1000.00',
            amountUsd: '25.00',
          },
        ],
      });
      await host.db.invoice.update({
        where: { id: 'inv_2' },
        data: { paidAmount: dec('1000'), balance: dec('3000'), status: 'PARCIAL' },
      });
      return {
        invoices: ['inv_2'],
        payments: ['pay_2'],
        accounts: ['acc_ves'],
        clients: ['cli_a'],
        projects: ['pry_b'],
      };
    });
    expect(state.accounts[1]).toEqual(['acc_ves', '1980.00']);
    // credit: unallocated 2000 − 60 − 1000 = 940 VES at 40
    expect(state.clients[0]).toMatchObject({ credit: '23.50', collected: '525.00' });
    expect(state.payments.find((row) => row[0] === 'pay_2')).toEqual([
      'pay_2',
      '1940.00',
      '1980.00',
      '940.00',
    ]);
  });

  it('4 - paid expenses charge their project and account; pending ones do nothing', async () => {
    const state = await step(async () => {
      await seedExpense(host.db, {
        id: 'exp_1',
        categoryId,
        amount: '50.00',
        accountId: 'acc_usd',
        projectId: 'pry_a',
      });
      await seedExpense(host.db, {
        id: 'exp_2',
        categoryId,
        amount: '800.00',
        currency: 'VES',
        usdRate: '40',
        accountId: 'acc_ves',
        projectId: 'pry_b',
      });
      await seedExpense(host.db, {
        id: 'exp_3',
        categoryId,
        amount: '70.00',
        projectId: 'pry_a',
        status: 'PENDIENTE',
      });
      await seedExpense(host.db, {
        id: 'exp_4',
        categoryId,
        amount: '9.00',
        accountId: 'acc_usd',
        archived: true,
      });
      return {
        expenses: ['exp_1', 'exp_2', 'exp_3', 'exp_4'],
        accounts: ['acc_usd', 'acc_ves'],
        projects: ['pry_a', 'pry_b'],
      };
    });
    expect(state.accounts).toEqual([
      ['acc_usd', '550.00'],
      ['acc_ves', '1180.00'],
    ]);
    expect(state.projects[0]).toMatchObject({ expenses: '50.00', margin: '223.72' });
  });

  it('5 - transfers and movements apply the type sign (DT-106)', async () => {
    const state = await step(async () => {
      await host.db.accountTransfer.create({
        data: {
          id: 'trf_1',
          date: new Date('2026-02-20'),
          fromAccountId: 'acc_usd',
          toAccountId: 'acc_ves',
          amountFrom: dec('10'),
          amountTo: dec('400'),
          feeAmount: dec('1'),
          amountUsd: dec('10'),
        },
      });
      await host.db.accountMovement.createMany({
        data: [
          {
            id: 'mov_1',
            accountId: 'acc_usd',
            type: 'APORTE_CAPITAL',
            date: new Date('2026-02-21'),
            amount: dec('200'),
            amountUsd: dec('200'),
            description: 'a',
          },
          {
            id: 'mov_2',
            accountId: 'acc_usd',
            type: 'RETIRO_SOCIO',
            date: new Date('2026-02-22'),
            amount: dec('30'),
            amountUsd: dec('30'),
            description: 'r',
          },
          {
            id: 'mov_3',
            accountId: 'acc_usd',
            type: 'AJUSTE',
            date: new Date('2026-02-23'),
            amount: dec('-5'),
            amountUsd: dec('-5'),
            description: 'j',
          },
        ],
      });
      return {
        transfers: ['trf_1'],
        movements: ['mov_1', 'mov_2', 'mov_3'],
        accounts: ['acc_usd', 'acc_ves'],
      };
    });
    // 550 − 11 + 200 − 30 − 5 and 1180 + 400
    expect(state.accounts).toEqual([
      ['acc_usd', '704.00'],
      ['acc_ves', '1580.00'],
    ]);
  });

  it('6 - voiding a payment soft-deletes its allocations and reopens the invoice', async () => {
    const state = await step(async () => {
      await host.db.payment.update({
        where: { id: 'pay_1' },
        data: { status: 'ANULADO', unallocated: dec('500') },
      });
      await host.db.paymentAllocation.update({
        where: { id: 'al_1' },
        data: { deletedAt: new Date('2026-03-05') },
      });
      await host.db.invoice.update({
        where: { id: 'inv_1' },
        data: { paidAmount: dec('0'), balance: dec('1096') },
      });
      await host.db.billingInstallment.update({
        where: { id: 'ins_1' },
        data: { status: 'FACTURADA' },
      });
      return {
        payments: ['pay_1'],
        accounts: ['acc_usd'],
        clients: ['cli_a'],
        projects: ['pry_a', 'pry_b'],
      };
    });
    expect(state.accounts[0]).toEqual(['acc_usd', '204.00']);
    expect(
      state.facts.map((f) => JSON.parse(f) as string[]).filter((f) => f[1] === 'pay_1'),
    ).toEqual([]);
  });

  it('7 - drafts, archived and pending-verification sources count nowhere', async () => {
    const before = await snapshot();
    const state = await step(async () => {
      await seedInvoice(host.db, {
        id: 'inv_3',
        clientId: 'cli_a',
        status: 'BORRADOR',
        lines: [{ id: 'inv_3_a', projectId: 'pry_a', unitPrice: '900.00', ivaRate: null }],
      });
      await seedInvoice(host.db, {
        id: 'inv_4',
        clientId: 'cli_a',
        archived: true,
        lines: [{ id: 'inv_4_a', projectId: 'pry_a', unitPrice: '800.00', ivaRate: null }],
      });
      await seedPayment(host.db, {
        id: 'pay_3',
        clientId: 'cli_a',
        accountId: 'acc_usd',
        methodId,
        amount: '999.00',
        status: 'PENDIENTE_VERIFICACION',
      });
      return {
        invoices: ['inv_3', 'inv_4'],
        payments: ['pay_3'],
        accounts: ['acc_usd'],
        clients: ['cli_a'],
        projects: ['pry_a'],
      };
    });
    expect(state.clients).toEqual(before.clients);
    expect(state.projects).toEqual(before.projects);
    expect(state.facts).toEqual(before.facts);
  });

  it('8 - an adjusted IVA line (±0.01) survives the rebuild while taxBase and rate are unchanged', async () => {
    await step(async () => {
      await host.db.invoiceTaxLine.updateMany({
        where: { invoiceId: 'inv_1' },
        data: { ivaAmount: dec('96.01') },
      });
      await host.db.invoice.update({
        where: { id: 'inv_1' },
        data: {
          ivaAmount: dec('96.01'),
          total: dec('1096.01'),
          receivable: dec('1096.01'),
          totalUsd: dec('1096.01'),
          receivableUsd: dec('1096.01'),
          balance: dec('1096.01'),
        },
      });
      return { invoices: ['inv_1'], clients: ['cli_a'], projects: ['pry_a', 'pry_b'] };
    });
    const line = await admin.invoiceTaxLine.findFirstOrThrow({ where: { invoiceId: 'inv_1' } });
    expect(line.ivaAmount.toFixed(2)).toBe('96.01');
  });

  it('9 - voiding the invoice removes its facts and metrics contribution', async () => {
    const state = await step(async () => {
      await host.db.invoice.update({
        where: { id: 'inv_1' },
        data: { status: 'ANULADA', voidedAt: new Date('2026-03-06') },
      });
      await host.db.billingInstallment.update({
        where: { id: 'ins_1' },
        data: { status: 'PENDIENTE' },
      });
      return { invoices: ['inv_1'], clients: ['cli_a'], projects: ['pry_a', 'pry_b'] };
    });
    expect(state.clients[0]).toMatchObject({
      invoiced: '100.00',
      receivable: '75.00',
      overdue: '0.00',
    });
    expect(
      state.facts.map((f) => JSON.parse(f) as string[]).filter((f) => f[1] === 'inv_1'),
    ).toEqual([]);
  });

  it('never reads the exchange rates: a changed rate leaves every snapshot as it was', async () => {
    await admin.exchangeRate.create({
      data: {
        date: new Date('2026-03-09'),
        currency: 'VES',
        usdRate: dec('999'),
        source: 'MANUAL',
      },
    });
    const before = await snapshot();
    await world.recomputeAll.execute(SYSTEM_ACTOR);
    expect(await snapshot()).toEqual(before);
  });

  it('keeps projectCount and lastActivityAt of ClientMetrics', async () => {
    await admin.clientMetrics.update({
      where: { clientId: 'cli_a' },
      data: { projectCount: 7, lastActivityAt: new Date('2026-03-01T00:00:00.000Z') },
    });
    await world.recomputeAll.execute(SYSTEM_ACTOR);
    const row = await admin.clientMetrics.findUniqueOrThrow({ where: { clientId: 'cli_a' } });
    expect([row.projectCount, row.lastActivityAt?.toISOString()]).toEqual([
      7,
      '2026-03-01T00:00:00.000Z',
    ]);
  });

  it('records each run as a SYSTEM_JOB entry and reports no problems on a consistent base', async () => {
    const result = await world.recomputeAll.execute(SYSTEM_ACTOR);
    expect(result.problems).toEqual([]);
    expect(result.counts.invoices).toBe(4);
    const entry = await admin.activityLog.findFirstOrThrow({
      where: { action: 'SYSTEM_JOB' },
      orderBy: { createdAt: 'desc' },
    });
    expect([entry.actorType, entry.actorId, entry.entityType, entry.entityId]).toEqual([
      'SYSTEM',
      null,
      'SETTING',
      'recompute-all',
    ]);
  });
});

describe('scripts/recompute-all', () => {
  it('runs the use case over the database it is given, as the SYSTEM actor', async () => {
    const result = await runRecomputeAll(process.env.DATABASE_URL);
    expect(result.problems).toEqual([]);
    expect(result.counts.clients).toBe(2);
  });

  it('refuses a database that is not local, without echoing the URL', async () => {
    const url = 'postgresql://user:secret@db.example.com:5432/core';
    const error = await runRecomputeAll(url).then(
      () => null,
      (reason: Error) => reason,
    );
    expect(error?.message).toBe('Refusing to run against a non-local database host');
    expect(error?.message).not.toContain('secret');
    await expect(runRecomputeAll(undefined)).rejects.toThrow('DATABASE_URL is not set');
    await expect(
      runRecomputeAll('postgresql://u:p@localhost/core?host=db.example.com'),
    ).rejects.toThrow('host override');
  });
});
