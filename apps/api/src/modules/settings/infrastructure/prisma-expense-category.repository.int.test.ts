import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { ExpenseCategory } from '../domain/expense-category';
import { PrismaExpenseCategoryRepository } from './prisma-expense-category.repository';

/** Test rows only: the seeded tree is never touched. */
const TEST_IDS = ['ecat_int_root', 'ecat_int_child'];
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaExpenseCategoryRepository(host);

const category = (id: string, overrides: Partial<ExpenseCategory> = {}): ExpenseCategory => ({
  id,
  name: `Categoria ${id}`,
  nameEn: null,
  color: null,
  parentId: null,
  active: true,
  ...overrides,
});

beforeAll(() => {
  assertLocalDatabaseUrl(process.env.DATABASE_URL);
});
beforeEach(async () => {
  await admin.expenseCategory.deleteMany({ where: { id: { in: TEST_IDS } } });
});
afterAll(async () => {
  await admin.expenseCategory.deleteMany({ where: { id: { in: TEST_IDS } } });
  await service.client.$disconnect();
  await admin.$disconnect();
});

describe('PrismaExpenseCategoryRepository (int)', () => {
  it('lists the seeded categories, roots and children alike', async () => {
    const rows = await repository.list();
    expect(rows.some((row) => row.parentId === null)).toBe(true);
    expect(rows.some((row) => row.parentId !== null)).toBe(true);
  });

  it('inserts a root and a child, and finds them by id', async () => {
    const root = category('ecat_int_root', { color: '#123456' });
    const child = category('ecat_int_child', { parentId: 'ecat_int_root', nameEn: 'Child' });
    await uow.run(async () => {
      await repository.insert(root);
      await repository.insert(child);
    });
    await expect(repository.findById('ecat_int_root')).resolves.toEqual(root);
    await expect(repository.findById('ecat_int_child')).resolves.toEqual(child);
    await expect(repository.findById('ecat_int_missing')).resolves.toBeNull();
  });

  it('updates the fields of a row, including its active flag', async () => {
    await uow.run(() => repository.insert(category('ecat_int_root')));
    const updated = category('ecat_int_root', {
      name: 'Renombrada',
      color: '#000000',
      active: false,
    });
    await uow.run(() => repository.update(updated));
    await expect(repository.findById('ecat_int_root')).resolves.toEqual(updated);
  });
});
