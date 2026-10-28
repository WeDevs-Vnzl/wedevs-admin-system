import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  buildExpenseCategoryTree,
  type ExpenseCategoryTreeNode,
} from '../../domain/expense-category';
import type { ExpenseCategoryRepository } from '../ports/expense-category.repository.port';
import type { ListCatalogInput } from './list-currencies.use-case';

/**
 * The expense category tree (PRD §8.8, §8.15): roots with their children. Pickers get the active rows; Settings
 * asks for every row with `includeInactive`. Authorization is the route's `@Authenticated()` declaration (DT-71).
 */
export class ListExpenseCategories {
  constructor(private readonly categories: ExpenseCategoryRepository) {}

  async execute(_actor: CurrentUser, input: ListCatalogInput): Promise<ExpenseCategoryTreeNode[]> {
    return buildExpenseCategoryTree(await this.categories.list(), input.includeInactive);
  }
}
