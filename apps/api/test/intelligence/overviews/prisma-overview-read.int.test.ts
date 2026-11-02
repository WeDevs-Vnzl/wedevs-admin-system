import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaOverviewRead } from '../../../src/modules/intelligence/infrastructure/prisma-overview-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import {
  makeAccount,
  makeClient,
  makeDocument,
  makeInvoice,
  makePayment,
  makeProject,
  uid,
} from '../../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

const prisma = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const read = new PrismaOverviewRead(new TransactionHost(service));
const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

beforeAll(() => truncateBusinessTables(prisma), 60_000);
beforeEach(() => truncateBusinessTables(prisma), 60_000);
afterAll(async () => {
  await truncateBusinessTables(prisma);
  await service.client.$disconnect();
  await prisma.$disconnect();
});

describe('topTechnologies', () => {
  it('counts live projects per technology, most used first, ties by id, and honours the limit', async () => {
    const found = await prisma.technology.findMany({ orderBy: { id: 'asc' }, take: 3 });
    const [a, b, c] = found as [(typeof found)[0], (typeof found)[0], (typeof found)[0]];
    const live1 = await makeProject(prisma);
    const live2 = await makeProject(prisma);
    const gone = await makeProject(prisma);
    await prisma.project.update({ where: { id: gone.id }, data: { deletedAt: d('2026-01-01') } });
    const link = (projectId: string, technologyId: string) =>
      prisma.projectTechnology.create({ data: { projectId, technologyId } });
    await link(live1.id, b.id);
    await link(live2.id, b.id);
    await link(live1.id, a.id);
    await link(live1.id, c.id);
    // An archived project does not count.
    await link(gone.id, c.id);
    await link(gone.id, a.id);

    const rows = await read.topTechnologies(10);

    expect(rows.map((r) => [r.id, r.projectCount])).toEqual([
      [b.id, 2],
      [a.id, 1],
      [c.id, 1],
    ]);
    expect(rows[0]).toEqual({
      id: b.id,
      name: b.name,
      nameEn: b.nameEn,
      category: b.category,
      iconSlug: b.iconSlug,
      color: b.color,
      projectCount: 2,
    });
    expect(await read.topTechnologies(1)).toHaveLength(1);
  });
});

describe('invoiceCurrencyTotals', () => {
  it('sums live invoices per currency; drafts, voided and archived ones count for nothing', async () => {
    const client = await makeClient(prisma);
    const overdue = await makeInvoice(prisma, client.id);
    const open = await makeInvoice(prisma, client.id);
    const draft = await makeInvoice(prisma, client.id);
    const voided = await makeInvoice(prisma, client.id);
    const archived = await makeInvoice(prisma, client.id, { deleted: true });
    const set = (id: string, data: Record<string, unknown>) =>
      prisma.invoice.update({ where: { id }, data });
    await set(overdue.id, { status: 'VENCIDA', total: '100.10', balance: '40.05' });
    await set(open.id, { status: 'PARCIAL', total: '0.20', balance: '0.20' });
    await set(draft.id, { isDraft: true, status: 'BORRADOR', total: '999', balance: '999' });
    await set(voided.id, {
      status: 'ANULADA',
      voidedAt: d('2026-01-01'),
      total: '999',
      balance: '999',
    });
    await set(archived.id, { total: '999', balance: '999' });

    expect(await read.invoiceCurrencyTotals()).toEqual([
      {
        currency: 'USD',
        total: '100.30',
        balance: '40.25',
        overdue: '40.05',
        overdueCount: 1,
      },
    ]);
  });

  it('is empty without invoices and orders currencies ascending', async () => {
    expect(await read.invoiceCurrencyTotals()).toEqual([]);
    const client = await makeClient(prisma);
    const ves = await prisma.currency.findFirst({ where: { code: 'VES' } });
    if (!ves) return;
    const invoice = await makeInvoice(prisma, client.id);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { currency: 'VES' } });
    await makeInvoice(prisma, client.id);
    expect((await read.invoiceCurrencyTotals()).map((r) => r.currency)).toEqual(['USD', 'VES']);
  });
});

describe('labels', () => {
  it('maps method ids to code and name, account ids to names and category ids to names', async () => {
    const method = await prisma.paymentMethod.findFirstOrThrow();
    const account = await makeAccount(prisma);
    const category = await prisma.expenseCategory.findFirstOrThrow();

    expect(await read.paymentMethodLabels([method.id, 'unknown'])).toEqual(
      new Map([[method.id, { code: method.code, name: method.name }]]),
    );
    expect(await read.accountNames([account.id, 'unknown'])).toEqual(
      new Map([[account.id, account.name]]),
    );
    expect(await read.expenseCategoryNames([category.id])).toEqual(
      new Map([[category.id, category.name]]),
    );
    expect(await read.accountNames([])).toEqual(new Map());
  });
});

describe('paymentQueues', () => {
  it('counts pending verification and the credit of confirmed payments, each at its own stored rate', async () => {
    const client = await makeClient(prisma);
    const account = await makeAccount(prisma);
    const credit = await makePayment(prisma, client.id, account.id);
    const credit2 = await makePayment(prisma, client.id, account.id);
    const settled = await makePayment(prisma, client.id, account.id);
    const pending = await makePayment(prisma, client.id, account.id);
    const archived = await makePayment(prisma, client.id, account.id);
    const set = (id: string, data: Record<string, unknown>) =>
      prisma.payment.update({ where: { id }, data });
    await set(credit.id, { unallocated: '1.01', usdRate: '2' });
    await set(credit2.id, { unallocated: '0.10', usdRate: '1' });
    await set(settled.id, { unallocated: '0' });
    await set(pending.id, { status: 'PENDIENTE_VERIFICACION', unallocated: '77' });
    await set(archived.id, { unallocated: '5', deletedAt: d('2026-01-01') });

    expect(await read.paymentQueues()).toEqual({
      pendingVerificationCount: 1,
      unallocatedCount: 2,
      // 1.01 / 2 = 0.505 -> 0.51 (half up), plus 0.10 at rate 1.
      unallocatedTotalUsd: '0.61',
    });
  });

  it('is zeros without payments', async () => {
    expect(await read.paymentQueues()).toEqual({
      pendingVerificationCount: 0,
      unallocatedCount: 0,
      unallocatedTotalUsd: '0.00',
    });
  });
});

describe('committedMonthlyUsd', () => {
  it('sums the stored monthly snapshots of the active schedules only', async () => {
    const make = (monthlyAmountUsd: string, data: Record<string, unknown> = {}) =>
      prisma.recurringExpense.create({
        data: {
          name: uid('rec'),
          categoryId: 'ecat_hosting',
          currency: 'USD',
          amount: '120',
          frequency: 'MENSUAL',
          dayOfPeriod: 1,
          startDate: d('2026-01-01'),
          usdRate: '1',
          monthlyAmountUsd,
          ...data,
        },
      });
    await make('10.10');
    await make('0.20');
    await make('999', { status: 'PAUSADO' });
    await make('999', { status: 'FINALIZADO' });
    await make('999', { deletedAt: d('2026-01-01') });

    expect(await read.committedMonthlyUsd()).toBe('10.30');
  });

  it('is zero with none', async () => {
    expect(await read.committedMonthlyUsd()).toBe('0.00');
  });
});

describe('documents', () => {
  it('counts live documents per category and status, every category present in order', async () => {
    const categories = await prisma.documentCategory.findMany({
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
    });
    const type = await prisma.documentType.findFirstOrThrow({ where: { id: 'dtyp_prd' } });
    const make = (data: Record<string, unknown> = {}) =>
      prisma.document.create({ data: { code: uid('doc'), title: 't', typeId: type.id, ...data } });
    await make({ status: 'BORRADOR' });
    await make({ status: 'BORRADOR' });
    await make({ status: 'FIRMADO' });
    await make({ status: 'APROBADO', deletedAt: d('2026-01-01') });

    const rows = await read.documentCategoryCounts();

    expect(rows.map((r) => r.id)).toEqual(categories.map((c) => c.id));
    const home = rows.find((r) => r.id === type.categoryId);
    expect(home?.countByStatus).toEqual({ BORRADOR: 2, FIRMADO: 1 });
    expect(
      rows
        .filter((r) => r.id !== type.categoryId)
        .every((r) => !Object.keys(r.countByStatus).length),
    ).toBe(true);
    expect(home).toMatchObject({
      name: categories.find((c) => c.id === type.categoryId)?.name,
    });
  });

  it('counts documents expiring within 30, 60 and 90 days, inclusive, cumulative, skipping VENCIDO, ANULADO and archived', async () => {
    const make = (expiresAt: string | null, data: Record<string, unknown> = {}) =>
      prisma.document.create({
        data: {
          code: uid('doc'),
          title: 't',
          typeId: 'dtyp_prd',
          expiresAt: expiresAt ? d(expiresAt) : null,
          status: 'APROBADO',
          ...data,
        },
      });
    await make('2026-10-15'); // today: in all three
    await make('2026-11-14'); // today + 30: still the first window
    await make('2026-11-15'); // today + 31
    await make('2027-01-13'); // today + 90
    await make('2027-01-14'); // today + 91: outside
    await make('2026-10-14'); // yesterday: outside
    await make(null);
    await make('2026-10-20', { status: 'VENCIDO' });
    await make('2026-10-20', { status: 'ANULADO' });
    await make('2026-10-20', { deletedAt: d('2026-01-01') });

    expect(await read.documentExpiringCounts('2026-10-15')).toEqual({
      days30: 2,
      days60: 3,
      days90: 4,
    });
    expect(await makeDocument(prisma)).toBeDefined();
  });
});

describe('activityCounts', () => {
  const criteria = (extra: Record<string, unknown> = {}) => ({
    page: 1,
    pageSize: 25,
    sort: { field: 'createdAt' as const, direction: 'desc' as const },
    search: null,
    actorIds: [],
    actorTypes: [],
    actions: [],
    entityTypes: [],
    entityId: null,
    createdFrom: null,
    createdBefore: null,
    ...extra,
  });
  const log = (data: {
    createdAt: string;
    actorType?: 'USER' | 'SYSTEM';
    actorId?: string;
    action?: 'CREATE' | 'UPDATE';
    label?: string;
  }) =>
    prisma.activityLog.create({
      data: {
        actorType: data.actorType ?? 'USER',
        actorId: data.actorId ?? null,
        action: data.action ?? 'CREATE',
        entityType: 'CLIENT',
        entityId: 'cli_1',
        entityLabel: data.label ?? 'Kairos',
        createdAt: new Date(data.createdAt),
      },
    });
  const day = {
    todayStart: new Date('2026-10-15T04:00:00.000Z'),
    tomorrowStart: new Date('2026-10-16T04:00:00.000Z'),
  };

  it('counts the filtered total, the Caracas day regardless of the filter, and the user actions of the filter', async () => {
    const user = await prisma.user.create({
      data: { clerkId: uid('c'), email: `${uid('e')}@example.test`, name: 'Ana' },
    });
    await log({ createdAt: '2026-10-15T03:59:59.999Z', actorId: user.id }); // Caracas 14th, 23:59
    await log({ createdAt: '2026-10-15T04:00:00.000Z', actorId: user.id });
    await log({ createdAt: '2026-10-15T20:00:00.000Z', actorType: 'SYSTEM', action: 'UPDATE' });
    await log({ createdAt: '2026-10-16T04:00:00.000Z', actorId: user.id });

    expect(await read.activityCounts({ filter: criteria(), ...day })).toEqual({
      total: 4,
      today: 2,
      users: 3,
    });
    expect(
      await read.activityCounts({ filter: criteria({ actions: ['UPDATE'] }), ...day }),
    ).toEqual({ total: 1, today: 2, users: 0 });
    expect(
      await read.activityCounts({
        filter: criteria({
          createdFrom: new Date('2026-10-15T04:00:00.000Z'),
          createdBefore: new Date('2026-10-16T04:00:00.000Z'),
        }),
        ...day,
      }),
    ).toEqual({ total: 2, today: 2, users: 1 });
  });

  it('searches the label and the actor name accent-insensitively, and keeps metacharacters inert', async () => {
    const user = await prisma.user.create({
      data: { clerkId: uid('c'), email: `${uid('e')}@example.test`, name: 'José' },
    });
    await log({ createdAt: '2026-10-15T10:00:00.000Z', label: 'Inversión Digital' });
    await log({ createdAt: '2026-10-15T10:00:00.000Z', actorId: user.id, label: 'Otro' });
    const count = async (search: string) =>
      (await read.activityCounts({ filter: criteria({ search }), ...day })).total;

    expect(await count('inversion')).toBe(1);
    expect(await count('jose')).toBe(1);
    expect(await count('%')).toBe(0);
    expect(await count('\'; DROP TABLE "ActivityLog"; --')).toBe(0);
  });
});
