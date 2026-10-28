import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../../../../test/support/fakes/sequential-id-generator';
import { InMemoryExpenseCategoryRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-expense-category.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { ExpenseCategory } from '../../domain/expense-category';
import { CreateExpenseCategory } from './create-expense-category.use-case';

const INFRA: ExpenseCategory = {
  id: 'infra',
  name: 'Infraestructura',
  nameEn: null,
  color: null,
  parentId: null,
  active: true,
};
const HOSTING: ExpenseCategory = {
  id: 'hosting',
  name: 'Hosting',
  nameEn: null,
  color: null,
  parentId: 'infra',
  active: true,
};

function setup() {
  const uow = new InMemoryUnitOfWork();
  const categories = new InMemoryExpenseCategoryRepository(uow, [INFRA, HOSTING]);
  const activity = new InMemoryActivityLog(uow);
  const useCase = new CreateExpenseCategory(
    settingsPolicy,
    uow,
    categories,
    new SequentialIdGenerator('ecat'),
    activity,
  );
  return { categories, activity, useCase };
}

describe('CreateExpenseCategory', () => {
  it('creates a root and a child of a root, and logs one SETTINGS_CHANGE each', async () => {
    const { categories, activity, useCase } = setup();
    const root = await useCase.execute(actorOf('OWNER'), { name: 'Eventos', color: '#123456' });
    expect(root).toMatchObject({ id: 'ecat_1', name: 'Eventos', parentId: null, color: '#123456' });
    const child = await useCase.execute(actorOf('OWNER'), { name: 'Anuncios', parentId: root.id });
    expect(child).toMatchObject({
      name: 'Anuncios',
      parentId: 'ecat_1',
      nameEn: null,
      color: null,
    });
    expect(categories.rows.get('ecat_2')).toEqual(child);
    expect(activity.entries.map((entry) => entry.changes)).toEqual([
      { expenseCategory: [null, 'Eventos'] },
      { expenseCategory: [null, 'Anuncios'] },
    ]);
  });

  it('refuses a third level, with VALIDATION on the parent', async () => {
    const { categories, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('ADMIN'), { name: 'VPS', parentId: 'hosting' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { parentId: ['catalogs.expenseCategories.errors.parentNotRoot'] },
    });
    expect(categories.rows.size).toBe(2);
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses an unknown parent with VALIDATION on the parent', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), { name: 'VPS', parentId: 'ecat_missing' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { parentId: ['catalogs.expenseCategories.errors.parentNotRoot'] },
    });
  });

  it('refuses a repeated sibling name, case-insensitive, with CONFLICT on the name', async () => {
    const { categories, useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), { name: 'hosting', parentId: 'infra' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: ['catalogs.expenseCategories.errors.nameTaken'] },
    });
    expect(categories.rows.size).toBe(2);
  });

  it('refuses a Member with FORBIDDEN', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(actorOf('MEMBER'), { name: 'Eventos' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
