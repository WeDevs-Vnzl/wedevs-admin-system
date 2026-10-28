import { describe, expect, it } from 'vitest';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import { InMemoryExpenseCategoryRepository } from '../../../../../test/settings/catalogs/fakes/in-memory-expense-category.repository';
import { actorOf } from '../../../../../test/settings/catalogs/fakes/catalog-actors';
import type { ExpenseCategory } from '../../domain/expense-category';
import { ListExpenseCategories } from './list-expense-categories.use-case';

const category = (
  id: string,
  name: string,
  parentId: string | null,
  active = true,
): ExpenseCategory => ({
  id,
  name,
  nameEn: null,
  color: null,
  parentId,
  active,
});

const SEED = [
  category('infra', 'Infraestructura', null),
  category('hosting', 'Hosting', 'infra'),
  category('dbs', 'Bases de datos', 'infra', false),
  category('otros', 'Otros', null, false),
];

function setup() {
  const uow = new InMemoryUnitOfWork();
  return new ListExpenseCategories(new InMemoryExpenseCategoryRepository(uow, SEED));
}

describe('ListExpenseCategories', () => {
  it('returns the two-level tree, hiding inactive rows unless asked', async () => {
    const tree = await setup().execute(actorOf('MEMBER'), { includeInactive: false });
    expect(tree.map((node) => node.name)).toEqual(['Infraestructura']);
    expect(tree[0]?.children.map((child) => child.name)).toEqual(['Hosting']);
  });

  it('shows every row with includeInactive (Settings)', async () => {
    const tree = await setup().execute(actorOf('OWNER'), { includeInactive: true });
    expect(tree.map((node) => node.name)).toEqual(['Infraestructura', 'Otros']);
    expect(tree[0]?.children.map((child) => child.name)).toEqual(['Bases de datos', 'Hosting']);
  });
});
