import { describe, expect, it } from 'vitest';
import type { ExpenseCategory } from '../domain/expense-category';
import type { ExpenseCategoryRepository } from './ports/expense-category.repository.port';
import { ExpenseCategoryCatalogQuery } from './expense-category-catalog.query';

const rows = new Map([
  ['cat_active', { id: 'cat_active', active: true }],
  ['cat_retired', { id: 'cat_retired', active: false }],
]) as unknown as Map<string, ExpenseCategory>;

const repository = {
  findById: async (id: string) => rows.get(id) ?? null,
} as unknown as ExpenseCategoryRepository;

describe('ExpenseCategoryCatalogQuery (read for BE-3)', () => {
  const query = new ExpenseCategoryCatalogQuery(repository);

  it('answers an active category', async () => {
    expect(await query.activeCategory('cat_active')).toEqual({ id: 'cat_active' });
  });

  it('answers null for a retired category', async () => {
    expect(await query.activeCategory('cat_retired')).toBeNull();
  });

  it('answers null for an unknown category', async () => {
    expect(await query.activeCategory('cat_missing')).toBeNull();
  });
});
