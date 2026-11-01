import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaAlertSourcesRead } from '../../../src/modules/intelligence/infrastructure/prisma-alert-sources-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { makeAccount, makeClient, makeInvoice, makePayment } from '../../db/helpers';

const prisma = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const sources = new PrismaAlertSourcesRead(new TransactionHost(service));
const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

beforeAll(() => truncateBusinessTables(prisma), 60_000);
beforeEach(() => truncateBusinessTables(prisma), 60_000);
afterAll(async () => {
  await truncateBusinessTables(prisma);
  await service.client.$disconnect();
  await prisma.$disconnect();
});

describe('invoices', () => {
  it('overdue: VENCIDA only, never drafts or archived; maps the ref, balance and client name', async () => {
    const client = await makeClient(prisma);
    const base = await makeInvoice(prisma, client.id, { invoiceNumber: 'FAC-0001' });
    const draft = await makeInvoice(prisma, client.id);
    const gone = await makeInvoice(prisma, client.id, { deleted: true });
    const open = await makeInvoice(prisma, client.id);
    await prisma.invoice.update({
      where: { id: base.id },
      data: { status: 'VENCIDA', dueDate: d('2026-01-10'), balance: '116' },
    });
    await prisma.invoice.update({
      where: { id: draft.id },
      data: { status: 'VENCIDA', isDraft: true },
    });
    await prisma.invoice.update({ where: { id: gone.id }, data: { status: 'VENCIDA' } });
    await prisma.invoice.update({ where: { id: open.id }, data: { status: 'EMITIDA' } });

    expect(await sources.overdueInvoices()).toEqual([
      {
        id: base.id,
        entity: { type: 'INVOICE', id: base.id, code: base.code, label: 'FAC-0001' },
        context: client.tradeName,
        archived: false,
        isDraft: false,
        status: 'VENCIDA',
        dueDate: '2026-01-10',
        balance: '116.00',
        currency: 'USD',
      },
    ]);
  });

  it('due soon: EMITIDA and PARCIAL inside the inclusive window only', async () => {
    const client = await makeClient(prisma);
    const inside = await makeInvoice(prisma, client.id);
    const edge = await makeInvoice(prisma, client.id);
    const before = await makeInvoice(prisma, client.id);
    const after = await makeInvoice(prisma, client.id);
    const paid = await makeInvoice(prisma, client.id);
    const set = (id: string, dueDate: string, status: 'EMITIDA' | 'PARCIAL' | 'PAGADA') =>
      prisma.invoice.update({ where: { id }, data: { dueDate: d(dueDate), status } });
    await set(inside.id, '2026-01-18', 'PARCIAL');
    await set(edge.id, '2026-01-22', 'EMITIDA');
    await set(before.id, '2026-01-14', 'EMITIDA');
    await set(after.id, '2026-01-23', 'EMITIDA');
    await set(paid.id, '2026-01-18', 'PAGADA');
    const rows = await sources.dueSoonInvoices({ from: '2026-01-15', to: '2026-01-22' });
    expect(rows.map((r) => r.id).sort()).toEqual([edge.id, inside.id].sort());
  });
});

describe('payments', () => {
  it('pending verification and unallocated credit narrow by status and date; amounts stay strings', async () => {
    const client = await makeClient(prisma);
    const account = await makeAccount(prisma);
    const pending = await makePayment(prisma, client.id, account.id, {
      amount: '100.10',
      date: d('2026-01-10'),
    });
    const confirmed = await makePayment(prisma, client.id, account.id, {
      amount: '80.00',
      date: d('2026-01-01'),
    });
    const settled = await makePayment(prisma, client.id, account.id, { date: d('2026-01-01') });
    const young = await makePayment(prisma, client.id, account.id, { date: d('2026-01-14') });
    await prisma.payment.update({
      where: { id: pending.id },
      data: { status: 'PENDIENTE_VERIFICACION' },
    });
    await prisma.payment.update({ where: { id: settled.id }, data: { unallocated: '0' } });
    await prisma.payment.update({
      where: { id: young.id },
      data: { status: 'PENDIENTE_VERIFICACION' },
    });

    const verify = await sources.pendingVerificationPayments('2026-01-12');
    expect(verify).toHaveLength(1);
    expect(verify[0]).toMatchObject({
      id: pending.id,
      entity: { type: 'PAYMENT', id: pending.id, code: pending.code, label: pending.code },
      context: client.tradeName,
      status: 'PENDIENTE_VERIFICACION',
      date: '2026-01-10',
      amount: '100.10',
      currency: 'USD',
    });

    const credit = await sources.unallocatedPayments('2026-01-14');
    expect(credit.map((r) => r.id)).toEqual([confirmed.id]);
    expect(credit[0]).toMatchObject({ unallocated: '80.00', status: 'CONFIRMADO' });
  });
});

describe('expenses, installments, documents and rates', () => {
  it('recurring expenses: generated PENDIENTE with a due date up to the bound', async () => {
    const recurring = await prisma.recurringExpense.create({
      data: {
        name: 'Hosting',
        categoryId: 'ecat_hosting',
        currency: 'USD',
        amount: '40',
        frequency: 'MENSUAL',
        dayOfPeriod: 5,
        startDate: d('2026-01-01'),
        usdRate: '1',
        monthlyAmountUsd: '40',
      },
    });
    const make = (code: string, extra: Record<string, unknown>) =>
      prisma.expense.create({
        data: {
          code,
          date: d('2026-01-01'),
          description: `desc ${code}`,
          vendor: code === 'e-vendor' ? 'Hetzner' : null,
          categoryId: 'ecat_hosting',
          currency: 'USD',
          amount: '40',
          usdRate: '1',
          amountUsd: '40',
          status: 'PENDIENTE',
          ...extra,
        },
      });
    const due = await make('e-vendor', {
      recurringExpenseId: recurring.id,
      dueDate: d('2026-01-18'),
    });
    await make('e-late', {
      recurringExpenseId: recurring.id,
      dueDate: d('2026-01-30'),
      periodStart: d('2026-02-01'),
    });
    await make('e-manual', { dueDate: d('2026-01-18') });
    await make('e-paid', {
      recurringExpenseId: recurring.id,
      dueDate: d('2026-01-18'),
      periodStart: d('2026-03-01'),
      status: 'PAGADO',
    });
    const rows = await sources.pendingRecurringExpenses('2026-01-20');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: due.id,
      recurring: true,
      status: 'PENDIENTE',
      dueDate: '2026-01-18',
      amount: '40.00',
      context: 'Hetzner',
      entity: { type: 'EXPENSE', id: due.id, label: 'desc e-vendor' },
    });
  });

  it('installments: PENDIENTE with a date up to the bound, of live projects, pointing at the project', async () => {
    const project = await prisma.project.create({
      data: { code: 'PRY-1', name: 'Portal', summary: 's' },
    });
    const dead = await prisma.project.create({
      data: { code: 'PRY-2', name: 'Old', summary: 's', deletedAt: d('2026-01-01') },
    });
    const inst = (
      label: string,
      projectId: string,
      dueDate: string | null,
      status = 'PENDIENTE' as const,
    ) =>
      prisma.billingInstallment.create({
        data: {
          projectId,
          kind: 'HITO',
          label,
          amount: '300',
          currency: 'USD',
          dueDate: dueDate ? d(dueDate) : null,
          status,
        },
      });
    const ok = await inst('Hito 1', project.id, '2026-01-20');
    await inst('late', project.id, '2026-01-25');
    await inst('nodate', project.id, null);
    await inst('billed', project.id, '2026-01-16', 'FACTURADA' as 'PENDIENTE');
    await inst('deadproject', dead.id, '2026-01-16');
    const rows = await sources.pendingInstallments('2026-01-22');
    expect(rows).toEqual([
      {
        id: ok.id,
        entity: { type: 'PROJECT', id: project.id, code: 'PRY-1', label: 'Portal' },
        context: 'Hito 1',
        archived: false,
        status: 'PENDIENTE',
        dueDate: '2026-01-20',
        amount: '300.00',
        currency: 'USD',
      },
    ]);
  });

  it('documents: expiring excludes ANULADO, VENCIDO, archived and the past; expired is VENCIDO', async () => {
    const make = (code: string, extra: Record<string, unknown>) =>
      prisma.document.create({
        data: { code, title: `T ${code}`, typeId: 'dtyp_prd', status: 'FIRMADO', ...extra },
      });
    const soon = await make('doc-soon', { expiresAt: d('2026-02-01'), alertDaysBefore: 45 });
    await make('doc-past', { expiresAt: d('2026-01-14') });
    await make('doc-void', { expiresAt: d('2026-02-01'), status: 'ANULADO' });
    await make('doc-gone', { expiresAt: d('2026-02-01'), deletedAt: d('2026-01-01') });
    await make('doc-none', {});
    const expired = await make('doc-expired', { expiresAt: d('2026-01-01'), status: 'VENCIDO' });
    await make('doc-expired-gone', { status: 'VENCIDO', deletedAt: d('2026-01-01') });

    const type = await prisma.documentType.findUniqueOrThrow({ where: { id: 'dtyp_prd' } });
    const rows = await sources.expiringDocuments('2026-01-15');
    expect(rows).toEqual([
      {
        id: soon.id,
        entity: { type: 'DOCUMENT', id: soon.id, code: 'doc-soon', label: 'T doc-soon' },
        context: type.name,
        archived: false,
        status: 'FIRMADO',
        expiresAt: '2026-02-01',
        alertDaysBefore: 45,
      },
    ]);
    expect((await sources.expiredDocuments()).map((r) => r.id)).toEqual([expired.id]);
  });

  it('hasVesRate looks for a VES rate dated that day only', async () => {
    expect(await sources.hasVesRate('2026-01-15')).toBe(false);
    await prisma.exchangeRate.create({
      data: { date: d('2026-01-14'), currency: 'VES', usdRate: '36.5' },
    });
    await prisma.exchangeRate.create({
      data: { date: d('2026-01-15'), currency: 'EUR', usdRate: '0.9' },
    });
    expect(await sources.hasVesRate('2026-01-15')).toBe(false);
    await prisma.exchangeRate.create({
      data: { date: d('2026-01-15'), currency: 'VES', usdRate: '36.6' },
    });
    expect(await sources.hasVesRate('2026-01-15')).toBe(true);
  });
});
