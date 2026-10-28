import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryExpenseCategoryRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-expense-category.repository';
import {
  actorOf,
  settingsPolicy,
} from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { ExpenseCategory } from '../../domain/expense-category';
import { UpdateExpenseCategory } from './update-expense-category.use-case';

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
const OTROS: ExpenseCategory = {
  id: 'otros',
  name: 'Otros',
  nameEn: null,
  color: null,
  parentId: null,
  active: true,
};

function setup() {
  const uow = new InMemoryUnitOfWork();
  const categories = new InMemoryExpenseCategoryRepository(uow, [INFRA, HOSTING, OTROS]);
  const activity = new InMemoryActivityLog(uow);
  return {
    categories,
    activity,
    useCase: new UpdateExpenseCategory(settingsPolicy, uow, categories, activity),
  };
}

const FIELDS = { nameEn: null, color: null, parentId: null, active: true };

describe('UpdateExpenseCategory', () => {
  it('edits a category and logs the changed fields', async () => {
    const { categories, activity, useCase } = setup();
    const updated = await useCase.execute(actorOf('OWNER'), 'infra', {
      ...FIELDS,
      name: 'Infra',
      color: '#000000',
      active: false,
    });
    expect(updated).toMatchObject({ id: 'infra', name: 'Infra', active: false, parentId: null });
    expect(categories.rows.get('infra')).toEqual(updated);
    expect(activity.entries[0]?.changes).toEqual({
      name: ['Infraestructura', 'Infra'],
      color: [null, '#000000'],
      active: [true, false],
    });
  });

  it('refuses to nest a root that has children, with VALIDATION on the parent', async () => {
    const { categories, activity, useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'infra', {
        ...FIELDS,
        name: 'Infraestructura',
        parentId: 'otros',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { parentId: ['catalogs.expenseCategories.errors.hasChildren'] },
    });
    expect(categories.rows.get('infra')?.parentId).toBeNull();
    expect(activity.entries).toHaveLength(0);
  });

  it('refuses a category that is its own parent, before looking it up', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'otros', { ...FIELDS, name: 'Otros', parentId: 'otros' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('answers NOT_FOUND for an unknown id', async () => {
    const { useCase } = setup();
    await expect(
      useCase.execute(actorOf('OWNER'), 'ecat_missing', { ...FIELDS, name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets a root without children move under another root', async () => {
    const { categories, useCase } = setup();
    await useCase.execute(actorOf('ADMIN'), 'otros', {
      ...FIELDS,
      name: 'Otros',
      parentId: 'infra',
    });
    expect(categories.rows.get('otros')?.parentId).toBe('infra');
  });
});
