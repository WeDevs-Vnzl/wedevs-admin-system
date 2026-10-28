import type { ExpenseCategory } from '../../domain/expense-category';

/**
 * Access to the `ExpenseCategory` table. Reads and writes run in the caller's unit of work when one is open.
 * Rows are never deleted (C19); a retired category is written with `active: false`.
 */
export interface ExpenseCategoryRepository {
  /** Every row, active or not; the use case builds the tree and checks the placement. */
  list(): Promise<ExpenseCategory[]>;
  /** `null` when no row has the id. */
  findById(id: string): Promise<ExpenseCategory | null>;
  insert(category: ExpenseCategory): Promise<void>;
  /** Writes the editable fields of an existing row. */
  update(category: ExpenseCategory): Promise<void>;
}

export const EXPENSE_CATEGORY_REPOSITORY = Symbol('EXPENSE_CATEGORY_REPOSITORY');
