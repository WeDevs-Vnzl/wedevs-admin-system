import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ExpenseRecord } from '../../../src/modules/finance/application/ports/expense.repository.port';
import type { RecurringExpenseRecord } from '../../../src/modules/finance/application/ports/expense-recurring.repository.port';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { seedAccount, seedClient, seedProject, seedSearchEntry } from '../read-models/world';
import { buildExpenseWorld, type ExpenseWorld } from './int-world';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
let world: ExpenseWorld;
let categoryId = '';
let parentId = '';
let childId = '';

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  world = buildExpenseWorld(service);
  const child = await admin.expenseCategory.findFirstOrThrow({
    where: { parentId: { not: null } },
  });
  childId = child.id;
  parentId = child.parentId as string;
  categoryId = childId;
  await world.uow.run(async () => {
    await seedClient(world.host.db, 'cli_a');
    await seedProject(world.host.db, 'pry_a', ['cli_a']);
    await seedAccount(world.host.db, 'acc_usd', 'USD', '100.00');
  });
}, 60_000);

const record = (over: Partial<ExpenseRecord> = {}): ExpenseRecord => ({
  id: 'exp_a',
  code: 'GAS-0001',
  date: '2026-10-05',
  dueDate: '2026-10-20',
  paidAt: null,
  description: 'Hosting Vercel',
  vendor: 'Vercel',
  categoryId,
  accountId: null,
  projectId: null,
  currency: 'USD',
  amount: '50.00',
  accountAmount: null,
  usdRate: '1',
  amountUsd: '50.00',
  status: 'PENDIENTE',
  receiptFileId: null,
  recurringExpenseId: null,
  periodStart: null,
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
  createdById: null,
  ...over,
});

const insert = (over: Partial<ExpenseRecord> = {}) =>
  world.uow.run(() => world.expenses.insert(record(over)));

describe('PrismaExpenseRepository', () => {
  it('round-trips a record with money as two-decimal strings and dates as YYYY-MM-DD', async () => {
    await insert({
      amount: '50.00',
      amountUsd: '50.00',
      accountAmount: '7551.60',
      usdRate: '755.16',
    });

    // `updatedAt` is stamped by the database (`@updatedAt`), not taken from the record.
    expect(await world.expenses.findById('exp_a')).toEqual({
      ...record({
        amount: '50.00',
        amountUsd: '50.00',
        accountAmount: '7551.60',
        usdRate: '755.16',
      }),
      updatedAt: expect.any(String),
    });
    expect(await world.expenses.findById('missing')).toBeNull();
  });

  it('updates in place', async () => {
    await insert();

    await world.uow.run(() =>
      world.expenses.update(
        record({
          status: 'PAGADO',
          paidAt: '2026-10-08',
          accountId: 'acc_usd',
          projectId: 'pry_a',
        }),
      ),
    );

    expect(await world.expenses.findById('exp_a')).toMatchObject({
      status: 'PAGADO',
      paidAt: '2026-10-08',
      accountId: 'acc_usd',
      projectId: 'pry_a',
    });
  });

  it('views carry the labels of category (with parent), account and project', async () => {
    await insert({
      status: 'PAGADO',
      paidAt: '2026-10-08',
      accountId: 'acc_usd',
      projectId: 'pry_a',
    });

    const view = await world.expenses.view('exp_a');

    expect(view?.category).toMatchObject({ id: childId, parent: { id: parentId } });
    expect(view?.account).toEqual({ type: 'ACCOUNT', id: 'acc_usd', label: 'acc_usd' });
    expect(view?.project).toMatchObject({
      type: 'PROJECT',
      id: 'pry_a',
      code: expect.stringMatching(/^PRY-/),
    });
    expect(view?.recurringExpense).toBeNull();
  });

  it('a receipt file belongs to one expense: the second claim is a VALIDATION', async () => {
    const owner = await admin.user.create({
      data: { clerkId: 'user_repo', email: 'repo@example.test', name: 'O', role: 'OWNER' },
    });
    await admin.file.create({
      data: {
        id: 'file_a',
        storageKey: 'k/a.pdf',
        bucket: 'b',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: 'READY',
        uploadedById: owner.id,
      },
    });
    await insert({ receiptFileId: 'file_a' });

    await expect(
      insert({ id: 'exp_b', code: 'GAS-0002', receiptFileId: 'file_a' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { receiptFileId: ['expenses.errors.receiptUnavailable'] },
    });
    expect(await world.expenses.hasReceiptFile('file_a')).toBe(true);
    expect(await world.expenses.hasReceiptFile('file_b')).toBe(false);
  });

  it('labels the expenses that exist', async () => {
    await insert();

    expect([...(await world.expenses.labels(['exp_a', 'nope']))]).toEqual([
      ['exp_a', { code: 'GAS-0001', description: 'Hosting Vercel' }],
    ]);
  });

  describe('list', () => {
    const base = { sort: { field: 'code', direction: 'asc' as const }, page: 1, pageSize: 25 };
    const codes = async (filter: Partial<Parameters<typeof world.expenses.list>[0]>) =>
      (await world.expenses.list({ ...base, ...filter })).items.map((row) => row.code);

    beforeEach(async () => {
      await insert();
      await insert({
        id: 'exp_b',
        code: 'GAS-0002',
        date: '2026-10-02',
        description: 'Dominio',
        vendor: null,
        categoryId: parentId,
        currency: 'VES',
        amount: '755.16',
        usdRate: '755.16',
        amountUsd: '1.00',
        status: 'PAGADO',
        paidAt: '2026-10-02',
        accountId: 'acc_usd',
        projectId: 'pry_a',
      });
      await insert({
        id: 'exp_c',
        code: 'GAS-0003',
        date: '2026-09-01',
        description: 'Anulado',
        status: 'ANULADO',
        recurringExpenseId: null,
      });
      const tag = await admin.tag.create({ data: { name: 'repo-tag', color: '#112233' } });
      await admin.tagAssignment.create({ data: { tagId: tag.id, expenseId: 'exp_b' } });
    });

    it('filters by status, account, project, currency, date range and tag', async () => {
      expect(await codes({})).toEqual(['GAS-0001', 'GAS-0002', 'GAS-0003']);
      expect(await codes({ status: ['PAGADO', 'ANULADO'] })).toEqual(['GAS-0002', 'GAS-0003']);
      expect(await codes({ accountId: ['acc_usd'] })).toEqual(['GAS-0002']);
      expect(await codes({ projectId: ['pry_a'] })).toEqual(['GAS-0002']);
      expect(await codes({ currency: ['VES'] })).toEqual(['GAS-0002']);
      expect(await codes({ dateFrom: '2026-10-01', dateTo: '2026-10-03' })).toEqual(['GAS-0002']);
      const tag = await admin.tag.findFirstOrThrow();
      expect(await codes({ tagId: [tag.id] })).toEqual(['GAS-0002']);
    });

    it('a root category matches its children too, a leaf only itself', async () => {
      expect(await codes({ categoryId: [parentId] })).toEqual(['GAS-0001', 'GAS-0002', 'GAS-0003']);
      expect(await codes({ categoryId: [childId] })).toEqual(['GAS-0001', 'GAS-0003']);
    });

    it('resolves q through SearchEntry: code, description and vendor, accent- and case-folded, with filters and paging', async () => {
      const entry = (id: string, code: string, title: string, vendor: string | null) =>
        seedSearchEntry(admin, {
          entityType: 'EXPENSE',
          entityId: id,
          code,
          title,
          subtitle: vendor,
          body: vendor,
        });
      await entry('exp_a', 'GAS-0001', 'Hosting Vercel', 'Vercel');
      await entry('exp_b', 'GAS-0002', 'Dominio', 'Registrador José');
      await entry('exp_c', 'GAS-0003', 'Anulado', 'Vercel');
      expect(await codes({ q: 'gas-0002' })).toEqual(['GAS-0002']);
      expect(await codes({ q: 'DOMINIO' })).toEqual(['GAS-0002']);
      expect(await codes({ q: 'jose' })).toEqual(['GAS-0002']);
      expect(await codes({ q: 'vercel' })).toEqual(['GAS-0001', 'GAS-0003']);
      expect(await codes({ q: 'vercel', status: ['ANULADO'] })).toEqual(['GAS-0003']);
      expect(await codes({ q: 'vercel', categoryId: [parentId] })).toEqual([
        'GAS-0001',
        'GAS-0003',
      ]);
      expect(await codes({ q: 'vercel', categoryId: [childId], currency: ['VES'] })).toEqual([]);
      const tag = await admin.tag.findFirstOrThrow();
      expect(await codes({ q: 'o', tagId: [tag.id] })).toEqual(['GAS-0002']);
      const second = await world.expenses.list({ ...base, q: 'vercel', page: 2 });
      expect(second).toMatchObject({ total: 2, page: 2, items: [] });
      const sorted = await world.expenses.list({
        ...base,
        q: 'vercel',
        sort: { field: 'amountUsd', direction: 'desc' },
      });
      expect(sorted.items.map((row) => row.code)).toEqual(['GAS-0001', 'GAS-0003']);
    });

    it('sorts, pages and counts', async () => {
      const page = await world.expenses.list({
        ...base,
        sort: { field: 'amountUsd', direction: 'desc' },
        pageSize: 25,
      });
      expect(page.items.map((row) => row.code)).toEqual(['GAS-0001', 'GAS-0003', 'GAS-0002']);
      const second = await world.expenses.list({ ...base, pageSize: 25, page: 2 });
      expect(second).toMatchObject({ total: 3, page: 2, pageCount: 1, items: [] });
    });
  });
});

describe('PrismaExpenseRecurringRepository', () => {
  const schedule = (over: Partial<RecurringExpenseRecord> = {}): RecurringExpenseRecord => ({
    id: 'rex_a',
    name: 'Hosting',
    vendor: null,
    categoryId,
    accountId: null,
    projectId: null,
    currency: 'USD',
    amount: '120.00',
    frequency: 'MENSUAL',
    dayOfPeriod: 5,
    leadDays: 5,
    startDate: '2026-10-01',
    endDate: null,
    status: 'ACTIVO',
    lastGeneratedPeriodStart: null,
    resumedOn: null,
    usdRate: '1',
    monthlyAmountUsd: '120.00',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  });

  it('round-trips, updates and views a schedule', async () => {
    await world.uow.run(() => world.recurring.insert(schedule()));
    expect(await world.recurring.findById('rex_a')).toEqual(schedule());

    await world.uow.run(() =>
      world.recurring.update(
        schedule({
          status: 'PAUSADO',
          resumedOn: '2026-10-09',
          lastGeneratedPeriodStart: '2026-10-05',
        }),
      ),
    );
    expect(await world.recurring.view('rex_a')).toMatchObject({
      status: 'PAUSADO',
      resumedOn: '2026-10-09',
      lastGeneratedPeriodStart: '2026-10-05',
      category: { id: childId },
    });
  });

  it('lists ACTIVO ids and the generated periods, voided ones included', async () => {
    await world.uow.run(async () => {
      await world.recurring.insert(schedule());
      await world.recurring.insert(schedule({ id: 'rex_b', name: 'Paused', status: 'PAUSADO' }));
      await world.expenses.insert(
        record({ id: 'e1', code: 'GAS-1', recurringExpenseId: 'rex_a', periodStart: '2026-10-05' }),
      );
      await world.expenses.insert(
        record({
          id: 'e2',
          code: 'GAS-2',
          recurringExpenseId: 'rex_a',
          periodStart: '2026-11-05',
          status: 'ANULADO',
        }),
      );
    });

    expect(await world.recurring.activeIds()).toEqual(['rex_a']);
    const periods = await world.recurring.periodsOf(['rex_a', 'rex_b']);
    expect([...periods]).toEqual([
      ['rex_a', expect.arrayContaining(['2026-10-05', '2026-11-05'])],
      ['rex_b', []],
    ]);
    expect((await world.recurring.periodsOf([])).size).toBe(0);
  });

  it('lists with filters and sorts', async () => {
    await world.uow.run(async () => {
      await world.recurring.insert(schedule());
      await world.recurring.insert(
        schedule({
          id: 'rex_b',
          name: 'Dominio',
          frequency: 'ANUAL',
          status: 'PAUSADO',
          categoryId: parentId,
        }),
      );
    });
    const base = { sort: { field: 'name', direction: 'asc' as const }, page: 1, pageSize: 25 };
    const names = async (filter: Partial<Parameters<typeof world.recurring.list>[0]>) =>
      (await world.recurring.list({ ...base, ...filter })).items.map((row) => row.name);

    expect(await names({})).toEqual(['Dominio', 'Hosting']);
    expect(await names({ status: ['PAUSADO'] })).toEqual(['Dominio']);
    expect(await names({ frequency: ['ANUAL'] })).toEqual(['Dominio']);
    expect(await names({ categoryId: [parentId] })).toEqual(['Dominio', 'Hosting']);
    expect(await names({ q: 'HOST' })).toEqual(['Hosting']);
  });
});
