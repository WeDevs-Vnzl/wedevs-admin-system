import { toModuleQuery } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { ExpenseFiltersInput } from "@/lib/validators/expenses";
import { EXPENSE_FACETS } from "../columns";

/**
 * The table's list query as the expenses filter (`expenseFiltersSchema` input): facets go to their module keys
 * (`date` → `dateFrom` / `dateTo`). Shared by the server page and the table.
 */
export function expenseFilterOf(query: ListQuery): ExpenseFiltersInput {
  return toModuleQuery(query, EXPENSE_FACETS) as ExpenseFiltersInput;
}
