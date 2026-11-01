import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaDashboardPanelsRead } from '../../../src/modules/intelligence/infrastructure/prisma-dashboard-panels-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { parseDateOnly } from '../../../src/shared/domain/business-date';
import { makeAccount, makeClient, makeDocument, makeInvoice, makeProject } from '../../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const port = new PrismaDashboardPanelsRead(new TransactionHost(service));
const d = parseDateOnly;

beforeAll(() => truncateBusinessTables(admin));
beforeEach(async () => {
  await truncateBusinessTables(admin);
  await admin.exchangeRate.deleteMany();
});
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('invoicesDue', () => {
  it('lists open issued invoices by due date then code, valued at their own rate', async () => {
    const client = await makeClient(admin);
    const mk = async (
      code: string,
      data: {
        due: string;
        status?: 'EMITIDA' | 'PARCIAL' | 'VENCIDA' | 'PAGADA' | 'ANULADA' | 'BORRADOR';
        balance?: string;
        isDraft?: boolean;
        deleted?: boolean;
        currency?: string;
        rate?: string;
      },
    ) => {
      const row = await makeInvoice(admin, client.id, { deleted: data.deleted ?? false });
      return admin.invoice.update({
        where: { id: row.id },
        data: {
          code,
          invoiceNumber: `N-${code}`,
          dueDate: d(data.due),
          status: data.status ?? 'EMITIDA',
          balance: data.balance ?? '116.10',
          isDraft: data.isDraft ?? false,
          ...(data.currency ? { currency: data.currency, usdRate: data.rate ?? '1' } : {}),
        },
      });
    };
    await admin.currency.upsert({
      where: { code: 'VES' },
      update: {},
      create: { code: 'VES', name: 'Bolivar', symbol: 'Bs', decimals: 2 },
    });
    await mk('F-B', { due: '2026-02-01' });
    await mk('F-A', { due: '2026-02-01', status: 'PARCIAL' });
    await mk('F-0', { due: '2026-01-05', status: 'VENCIDA' });
    const ves = await mk('F-V', {
      due: '2026-03-01',
      currency: 'VES',
      rate: '36.5',
      balance: '365.00',
    });
    await mk('X-paid', { due: '2026-01-01', status: 'PAGADA', balance: '0' });
    await mk('X-void', { due: '2026-01-01', status: 'ANULADA' });
    await mk('X-draft', { due: '2026-01-01', status: 'BORRADOR', isDraft: true });
    await mk('X-zero', { due: '2026-01-01', balance: '0' });
    await mk('X-del', { due: '2026-01-01', deleted: true });

    const rows = await port.invoicesDue(10);
    expect(rows.map((r) => r.invoice.code)).toEqual(['F-0', 'F-A', 'F-B', 'F-V']);
    expect(rows[0]).toMatchObject({
      invoice: { type: 'INVOICE', label: 'N-F-0' },
      client: { type: 'CLIENT', id: client.id, label: client.tradeName },
      dueDate: '2026-01-05',
      currency: 'USD',
      balance: '116.10',
      balanceUsd: '116.10',
    });
    expect(rows[3]).toMatchObject({
      invoice: { id: ves.id },
      balance: '365.00',
      balanceUsd: '10.00',
    });
    expect(await port.invoicesDue(2)).toHaveLength(2);
  });
});

describe('installments, documents and recurring expenses', () => {
  it('lists pending dated installments of live projects up to the bound', async () => {
    const live = await makeProject(admin);
    const gone = await admin.project.create({
      data: { code: 'GONE', name: 'Gone', summary: 's', deletedAt: new Date() },
    });
    const inst = (projectId: string, label: string, due: string | null, extra = {}) =>
      admin.billingInstallment.create({
        data: {
          projectId,
          kind: 'HITO',
          label,
          amount: '75.50',
          currency: 'USD',
          dueDate: due ? d(due) : null,
          ...extra,
        },
      });
    await inst(live.id, 'late', '2026-01-10', { order: 2 });
    await inst(live.id, 'first', '2026-01-10', { order: 1 });
    await inst(live.id, 'edge', '2026-02-14');
    await inst(live.id, 'beyond', '2026-02-15');
    await inst(live.id, 'undated', null);
    await inst(live.id, 'billed', '2026-01-01', { status: 'FACTURADA' });
    await inst(gone.id, 'archived project', '2026-01-01');
    const rows = await port.installmentsToInvoice('2026-02-14');
    expect(rows.map((r) => r.installment.label)).toEqual(['first', 'late', 'edge']);
    expect(rows[0]).toMatchObject({
      project: { type: 'PROJECT', id: live.id, label: live.name },
      amount: '75.50',
      currency: 'USD',
      dueDate: '2026-01-10',
    });
  });

  it('lists documents expiring in the window, not voided, expired or archived', async () => {
    const mk = async (title: string, expiresAt: string | null, extra = {}) => {
      const row = await makeDocument(admin);
      return admin.document.update({
        where: { id: row.id },
        data: { title, expiresAt: expiresAt ? d(expiresAt) : null, ...extra },
      });
    };
    await mk('b', '2026-01-25');
    await mk('a', '2026-01-15');
    await mk('edge', '2026-02-14');
    await mk('before', '2026-01-14');
    await mk('after', '2026-02-15');
    await mk('none', null);
    await mk('voided', '2026-01-20', { status: 'ANULADO' });
    await mk('expired', '2026-01-20', { status: 'VENCIDO' });
    await mk('archived', '2026-01-20', { deletedAt: new Date() });
    const rows = await port.documentsExpiring('2026-01-15', '2026-02-14');
    expect(rows.map((r) => r.document.label)).toEqual(['a', 'b', 'edge']);
    expect(rows[0]).toMatchObject({ document: { type: 'DOCUMENT' }, expiresAt: '2026-01-15' });
  });

  it('lists only the pending expenses a recurring expense generated', async () => {
    const recurring = await admin.recurringExpense.create({
      data: {
        name: 'Hosting',
        categoryId: 'ecat_hosting',
        currency: 'USD',
        amount: '40',
        frequency: 'MENSUAL',
        dayOfPeriod: 5,
        startDate: d('2025-01-01'),
        usdRate: '1',
        monthlyAmountUsd: '40',
      },
    });
    const exp = (code: string, extra: Record<string, unknown>) =>
      admin.expense.create({
        data: {
          code,
          date: d('2026-01-01'),
          description: code,
          categoryId: 'ecat_hosting',
          currency: 'USD',
          amount: '40',
          usdRate: '1',
          amountUsd: '40',
          status: 'PENDIENTE',
          ...extra,
        },
      });
    await exp('G-2', {
      dueDate: d('2026-01-30'),
      recurringExpenseId: recurring.id,
      periodStart: d('2026-01-30'),
    });
    await exp('G-1', {
      dueDate: d('2026-01-10'),
      recurringExpenseId: recurring.id,
      periodStart: d('2026-01-10'),
    });
    await exp('G-far', {
      dueDate: d('2026-03-10'),
      recurringExpenseId: recurring.id,
      periodStart: d('2026-03-10'),
    });
    await exp('G-paid', {
      dueDate: d('2026-01-12'),
      status: 'PAGADO',
      recurringExpenseId: recurring.id,
      periodStart: d('2026-01-12'),
    });
    await exp('G-manual', { dueDate: d('2026-01-12') });
    const rows = await port.upcomingRecurringExpenses('2026-02-14');
    expect(rows.map((r) => r.expense.code)).toEqual(['G-1', 'G-2']);
    expect(rows[0]).toMatchObject({ dueDate: '2026-01-10', amount: '40.00', amountUsd: '40.00' });
  });
});

describe('activity, charges and accounts', () => {
  it('lists the newest activity first with the actor name', async () => {
    const user = await admin.user.create({
      data: { clerkId: 'c1', email: 'a@example.test', name: 'Ana' },
    });
    const log = (id: string, at: string, actorId: string | null) =>
      admin.activityLog.create({
        data: {
          id,
          actorType: actorId ? 'USER' : 'SYSTEM',
          actorId,
          action: 'UPDATE',
          entityType: 'CLIENT',
          entityId: 'cli_1',
          entityLabel: 'Kairos',
          createdAt: new Date(at),
        },
      });
    await log('a1', '2026-01-10T10:00:00Z', user.id);
    await log('a3', '2026-01-12T10:00:00Z', null);
    await log('a2', '2026-01-12T10:00:00Z', user.id);
    const rows = await port.recentActivity(2);
    expect(rows.map((r) => r.id)).toEqual(['a3', 'a2']);
    expect(rows[0]).toMatchObject({
      actorName: null,
      entity: { type: 'CLIENT', id: 'cli_1', label: 'Kairos' },
    });
    expect(rows[1]?.actorName).toBe('Ana');
    expect(rows[1]?.createdAt).toEqual(new Date('2026-01-12T10:00:00Z'));
  });

  it('selects the charges whose dates cover the day, with their stored monthly USD', async () => {
    const live = await makeProject(admin);
    const gone = await admin.project.create({
      data: { code: 'GONE', name: 'Gone', summary: 's', deletedAt: new Date() },
    });
    const charge = (
      projectId: string,
      start: string,
      end: string | null,
      monthly: string,
      status = 'ACTIVO',
    ) =>
      admin.recurringCharge.create({
        data: {
          projectId,
          label: 'c',
          amount: '10',
          currency: 'USD',
          frequency: 'MENSUAL',
          startDate: d(start),
          endDate: end ? d(end) : null,
          billingDay: 1,
          status: status as 'ACTIVO',
          usdRate: '1',
          monthlyAmountUsd: monthly,
        },
      });
    await charge(live.id, '2025-06-01', null, '100.10');
    await charge(live.id, '2025-01-01', '2025-12-31', '30.00'); // ends on the day: still covers it
    await charge(live.id, '2025-01-01', '2025-12-30', '31.00');
    await charge(live.id, '2026-01-10', null, '50.00');
    await charge(live.id, '2025-01-01', null, '20.00', 'PAUSADO');
    await charge(gone.id, '2025-01-01', null, '999.00');
    const at = async (date: string) =>
      (await port.recurringChargesAt(date)).map((r) => `${r.monthlyAmountUsd}:${r.status}`).sort();
    expect(await at('2025-12-31')).toEqual(['100.10:ACTIVO', '20.00:PAUSADO', '30.00:ACTIVO']);
    expect(await at('2026-01-15')).toEqual(['100.10:ACTIVO', '20.00:PAUSADO', '50.00:ACTIVO']);
  });

  it('lists the balances of active accounts only', async () => {
    const a = await makeAccount(admin);
    const b = await makeAccount(admin);
    await admin.account.update({ where: { id: a.id }, data: { balance: '123.40' } });
    await admin.account.update({ where: { id: b.id }, data: { balance: '9.00', active: false } });
    expect(await port.activeAccountBalances()).toEqual([{ currency: 'USD', balance: '123.40' }]);
  });
});

describe('entity metrics', () => {
  it('reads a client with and without its metrics row, and reports archived', async () => {
    const withRow = await makeClient(admin);
    await admin.clientMetrics.create({
      data: {
        clientId: withRow.id,
        invoicedUsd: '1000.25',
        collectedUsd: '600',
        receivableUsd: '400.25',
        overdueUsd: '150',
        creditUsd: '25.5',
        projectCount: 2,
      },
    });
    const bare = await makeClient(admin);
    const gone = await admin.client.update({
      where: { id: (await makeClient(admin)).id },
      data: { deletedAt: new Date() },
    });
    expect((await port.clientMetrics(withRow.id))?.metrics).toMatchObject({
      clientId: withRow.id,
      invoicedUsd: '1000.25',
      collectedUsd: '600.00',
      receivableUsd: '400.25',
      overdueUsd: '150.00',
      creditUsd: '25.50',
      projectCount: 2,
    });
    expect(await port.clientMetrics(withRow.id)).toMatchObject({ archived: false });
    expect((await port.clientMetrics(bare.id))?.metrics.invoicedUsd).toBe('0.00');
    expect(await port.clientMetrics(gone.id)).toMatchObject({ archived: true });
    expect(await port.clientMetrics('nope')).toBeNull();
  });

  it('reads a project with its plan model and margin percent', async () => {
    const project = await makeProject(admin);
    await admin.projectMetrics.create({
      data: {
        projectId: project.id,
        contractedUsd: '2000',
        invoicedUsd: '1000',
        collectedUsd: '700',
        toInvoiceUsd: '1000',
        receivableUsd: '300',
        expensesUsd: '490',
        marginUsd: '210',
        monthlyRecurringUsd: '50',
      },
    });
    await admin.billingPlan.create({
      data: { projectId: project.id, model: 'MIXTO', currency: 'USD', contractedUsd: '2000' },
    });
    const bare = await makeProject(admin);
    const found = await port.projectMetrics(project.id);
    expect(found).toMatchObject({ archived: false, model: 'MIXTO' });
    expect(found?.metrics).toMatchObject({
      contractedUsd: '2000.00',
      expensesUsd: '490.00',
      marginUsd: '210.00',
      marginPercent: '30.00',
    });
    expect(await port.projectMetrics(bare.id)).toMatchObject({ model: null });
    expect(await port.projectMetrics('nope')).toBeNull();
  });
});
