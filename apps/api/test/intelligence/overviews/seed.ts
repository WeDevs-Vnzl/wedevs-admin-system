import type { PrismaClient } from '../../../src/generated/prisma/client';
import { makeAccount, makeInvoice, makePayment, uid } from '../../db/helpers';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * One studio, "today" being Thursday 2026-10-15 in Caracas. Every figure the e2e asserts is the one in
 * the comments, computed by hand from these rows.
 */
export async function seedStudio(db: PrismaClient) {
  const client = (id: string, tradeName: string, createdAt: string, extra: object = {}) =>
    db.client.create({
      data: {
        id,
        code: `CLI-${id}`,
        kind: 'EMPRESA',
        tradeName,
        legalName: tradeName,
        taxId: `J-${id}`,
        country: 'VE',
        address: 'Caracas',
        phone: '+58 212 0000000',
        createdAt: new Date(createdAt),
        ...extra,
      },
    });
  await client('cli_kairos', 'Kairos', '2026-02-01T12:00:00Z', { status: 'ACTIVO' });
  await client('cli_mochima', 'Mochima', '2026-03-01T12:00:00Z', { status: 'PROSPECTO' });
  await client('cli_zeta', 'Zeta', '2026-04-01T12:00:00Z', { status: 'INACTIVO' });
  await client('cli_old', 'Viejo', '2025-01-01T12:00:00Z', { deletedAt: d('2026-01-01') });
  // Kairos is the biggest in money but the oldest: a money order would put it first, a date order last.
  await db.clientMetrics.create({
    data: {
      clientId: 'cli_kairos',
      invoicedUsd: '500',
      collectedUsd: '300',
      receivableUsd: '200',
      overdueUsd: '120',
    },
  });
  await db.clientMetrics.create({
    data: { clientId: 'cli_mochima', receivableUsd: '40', overdueUsd: '40' },
  });

  const methods = await db.paymentMethod.findMany({ orderBy: { id: 'asc' }, take: 2 });
  const [methodA, methodB] = methods as [(typeof methods)[0], (typeof methods)[0]];
  const accountA = await makeAccount(db);
  const accountB = await makeAccount(db);
  const roots = await db.expenseCategory.findMany({
    where: { parentId: null },
    orderBy: { name: 'asc' },
    take: 2,
  });
  const [rootA, rootB] = roots as [(typeof roots)[0], (typeof roots)[0]];
  const child = await db.expenseCategory.findFirst({ where: { parentId: rootA.id } });

  const fact = (data: {
    kind: 'BILLED' | 'COLLECTED' | 'EXPENSE_PAID';
    date: string;
    amountUsd: string;
    clientId?: string;
    invoiceId?: string;
    dueDate?: string;
    methodId?: string;
    accountId?: string;
    categoryId?: string;
  }) =>
    db.financeFact.create({
      data: {
        kind: data.kind,
        date: d(data.date),
        amountUsd: data.amountUsd,
        clientId: data.clientId ?? null,
        invoiceId: data.invoiceId ?? null,
        dueDate: data.dueDate ? d(data.dueDate) : null,
        methodId: data.methodId ?? null,
        accountId: data.accountId ?? null,
        categoryId: data.categoryId ?? null,
        sourceType: data.kind === 'EXPENSE_PAID' ? 'EXPENSE' : 'INVOICE',
        sourceId: uid('src'),
      },
    });

  // Collected in the last 12 months (Nov 2025 - Oct 2026): Mochima 300.00 and Kairos 200.10 + 40.00 of the
  // invoice below. The 900 of Oct 2025 is outside the window; the archived client's 5000 (Aug 2026) counts in the month series but cannot rank, being no live row.
  await fact({
    kind: 'COLLECTED',
    date: '2026-09-10',
    amountUsd: '200.10',
    clientId: 'cli_kairos',
    methodId: methodA.id,
    accountId: accountA.id,
  });
  await fact({
    kind: 'COLLECTED',
    date: '2025-11-05',
    amountUsd: '300.00',
    clientId: 'cli_mochima',
    methodId: methodB.id,
    accountId: accountB.id,
  });
  await fact({
    kind: 'COLLECTED',
    date: '2025-10-01',
    amountUsd: '900.00',
    clientId: 'cli_mochima',
  });
  await fact({ kind: 'COLLECTED', date: '2026-08-20', amountUsd: '5000.00', clientId: 'cli_old' });

  // Two open invoices: inv1 100 billed, 40 collected, 60 open and 5 days late; inv2 70 open, 136 days late.
  const invoice1 = await makeInvoice(db, 'cli_kairos');
  const invoice2 = await makeInvoice(db, 'cli_mochima');
  const draft = await makeInvoice(db, 'cli_kairos');
  const voided = await makeInvoice(db, 'cli_kairos');
  await db.invoice.update({
    where: { id: invoice1.id },
    data: { status: 'VENCIDA', total: '100', balance: '60', dueDate: d('2026-10-10') },
  });
  await db.invoice.update({
    where: { id: invoice2.id },
    data: { status: 'VENCIDA', total: '70', balance: '70', dueDate: d('2026-06-01') },
  });
  await db.invoice.update({
    where: { id: draft.id },
    data: { isDraft: true, status: 'BORRADOR', total: '999', balance: '999' },
  });
  await db.invoice.update({
    where: { id: voided.id },
    data: { status: 'ANULADA', voidedAt: d('2026-01-01'), total: '999', balance: '999' },
  });
  await fact({
    kind: 'BILLED',
    date: '2026-09-01',
    amountUsd: '100.00',
    clientId: 'cli_kairos',
    invoiceId: invoice1.id,
    dueDate: '2026-10-10',
  });
  await fact({
    kind: 'COLLECTED',
    date: '2026-10-01',
    amountUsd: '40.00',
    clientId: 'cli_kairos',
    invoiceId: invoice1.id,
    methodId: methodA.id,
    accountId: accountA.id,
  });
  await fact({
    kind: 'BILLED',
    date: '2026-05-02',
    amountUsd: '70.00',
    clientId: 'cli_mochima',
    invoiceId: invoice2.id,
    dueDate: '2026-06-01',
  });

  // Payments: one waiting for verification and one confirmed with 97 of credit.
  const pending = await makePayment(db, 'cli_kairos', accountA.id);
  await db.payment.update({
    where: { id: pending.id },
    data: { status: 'PENDIENTE_VERIFICACION' },
  });
  const credit = await makePayment(db, 'cli_kairos', accountA.id);
  await db.payment.update({ where: { id: credit.id }, data: { unallocated: '97' } });
  const settled = await makePayment(db, 'cli_kairos', accountA.id);
  await db.payment.update({ where: { id: settled.id }, data: { unallocated: '0' } });

  // Expenses: paid spend in two roots (one through a child) and three pending ones.
  await fact({
    kind: 'EXPENSE_PAID',
    date: '2026-05-02',
    amountUsd: '1.10',
    categoryId: child?.id ?? rootA.id,
  });
  await fact({ kind: 'EXPENSE_PAID', date: '2026-10-15', amountUsd: '0.20', categoryId: rootA.id });
  await fact({ kind: 'EXPENSE_PAID', date: '2026-09-30', amountUsd: '2.38', categoryId: rootB.id });
  await fact({
    kind: 'EXPENSE_PAID',
    date: '2026-04-30',
    amountUsd: '50.00',
    categoryId: rootB.id,
  });
  const pendingExpense = async (code: string, dueDate: string) => {
    const expense = await db.expense.create({
      data: {
        code,
        date: d('2026-10-01'),
        dueDate: d(dueDate),
        description: code,
        categoryId: rootA.id,
        currency: 'USD',
        amount: '20',
        usdRate: '1',
        amountUsd: '20',
        status: 'PENDIENTE',
      },
    });
    return expense;
  };
  await pendingExpense('GAS-late', '2026-10-10');
  await pendingExpense('GAS-next', '2026-10-20');
  await pendingExpense('GAS-far', '2026-11-01');
  const recurring = (monthlyAmountUsd: string, extra: object = {}) =>
    db.recurringExpense.create({
      data: {
        name: uid('rec'),
        categoryId: rootA.id,
        currency: 'USD',
        amount: '120',
        frequency: 'MENSUAL',
        dayOfPeriod: 1,
        startDate: d('2026-01-01'),
        usdRate: '1',
        monthlyAmountUsd,
        ...extra,
      },
    });
  await recurring('10.10');
  await recurring('20.20');
  await recurring('999', { status: 'PAUSADO' });

  // Accounts: two active USD, one inactive USD that the total skips.
  const account = (name: string, balance: string, active = true) =>
    db.account.create({
      data: {
        name,
        type: 'BANCO_NACIONAL',
        currency: 'USD',
        openingDate: d('2026-01-01'),
        balance,
        active,
      },
    });
  await account('Caja', '100.10');
  await account('Reserva', '0.20');
  await account('Cerrada', '999', false);

  // Projects. P-A and P-B are running/paused and due soon; only P-B has a plan.
  const project = (
    id: string,
    status: 'EN_CURSO' | 'PAUSADO' | 'ENTREGADO',
    targetEndDate: string | null,
    extra: object = {},
  ) =>
    db.project.create({
      data: {
        id,
        code: `PRY-${id}`,
        name: id,
        summary: 's',
        status,
        targetEndDate: targetEndDate ? d(targetEndDate) : null,
        ...extra,
      },
    });
  await project('pa', 'EN_CURSO', '2026-11-10');
  await project('pb', 'PAUSADO', '2026-10-20');
  await project('pc', 'ENTREGADO', '2026-12-01');
  await project('pd', 'EN_CURSO', '2026-10-01');
  await project('pold', 'EN_CURSO', '2026-10-25', { deletedAt: d('2026-01-01') });
  await db.billingPlan.create({ data: { projectId: 'pb', model: 'PRECIO_FIJO', currency: 'USD' } });
  await db.projectMetrics.create({ data: { projectId: 'pa', toInvoiceUsd: '500' } });
  await db.projectMetrics.create({ data: { projectId: 'pb', toInvoiceUsd: '90.50' } });
  await db.projectMetrics.create({ data: { projectId: 'pc', toInvoiceUsd: '0' } });
  const tech = await db.technology.findFirstOrThrow({ orderBy: { id: 'asc' } });
  await db.projectTechnology.create({ data: { projectId: 'pa', technologyId: tech.id } });
  await db.projectTechnology.create({ data: { projectId: 'pb', technologyId: tech.id } });
  await db.projectTechnology.create({ data: { projectId: 'pold', technologyId: tech.id } });

  // Documents: expiring at 5, 47 and 87 days; a stale draft (44 days) and a fresh one; one archived.
  const doc = (
    id: string,
    status: 'FIRMADO' | 'APROBADO' | 'BORRADOR',
    updatedAt: string,
    expiresAt: string | null,
    extra: object = {},
  ) =>
    db.document.create({
      data: {
        id,
        code: `DOC-${id}`,
        title: id,
        typeId: 'dtyp_prd',
        status,
        updatedAt: new Date(updatedAt),
        expiresAt: expiresAt ? d(expiresAt) : null,
        ...extra,
      },
    });
  await doc('da', 'FIRMADO', '2026-10-01T12:00:00Z', '2026-10-20');
  await doc('db', 'APROBADO', '2026-10-02T12:00:00Z', '2026-12-01');
  await doc('dc', 'APROBADO', '2026-10-03T12:00:00Z', '2027-01-10');
  await doc('dd', 'BORRADOR', '2026-09-01T12:00:00Z', null);
  await doc('de', 'BORRADOR', '2026-10-14T12:00:00Z', null);
  await doc('dold', 'FIRMADO', '2026-10-10T12:00:00Z', '2026-10-22', {
    deletedAt: d('2026-01-01'),
  });
  const documentType = await db.documentType.findUniqueOrThrow({ where: { id: 'dtyp_prd' } });

  return {
    documentCategoryId: documentType.categoryId,
    techId: tech.id,
    rootA,
    rootB,
    methodA,
    methodB,
  };
}
