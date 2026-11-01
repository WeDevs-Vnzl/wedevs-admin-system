import type { ExpenseCategoryRepository } from './ports/expense-category.repository.port';

/**
 * Tells whether an expense category can be assigned. Exported for BE-3's expenses. Read-only: it never writes
 * and carries no `can()` (reference catalog read, DT-71).
 */
export class ExpenseCategoryCatalogQuery {
  constructor(private readonly categories: ExpenseCategoryRepository) {}

  async activeCategory(id: string): Promise<{ id: string } | null> {
    const category = await this.categories.findById(id);
    return category?.active ? { id: category.id } : null;
  }
}
