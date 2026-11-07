import type {
  ExpenseListQuery,
  ExpenseListSort,
  RecurringExpenseListQuery,
  RecurringExpenseListSort,
} from "@/lib/api/types/expenses";
import type { ExpenseFilters, RecurringExpenseFilters } from "@/lib/validators/expenses";

/**
 * Sort tokens of `GET /api/v1/expenses` and `GET /api/v1/recurring-expenses`. The records are exhaustive over the
 * generated unions, so a contract change that adds or removes a token fails `tsc` here (C8).
 */
const EXPENSE_SORTS: Record<ExpenseListSort, true> = {
  "code:asc": true,
  "code:desc": true,
  "date:asc": true,
  "date:desc": true,
  "dueDate:asc": true,
  "dueDate:desc": true,
  "description:asc": true,
  "description:desc": true,
  "vendor:asc": true,
  "vendor:desc": true,
  "amount:asc": true,
  "amount:desc": true,
  "amountUsd:asc": true,
  "amountUsd:desc": true,
  "status:asc": true,
  "status:desc": true,
};

const RECURRING_SORTS: Record<RecurringExpenseListSort, true> = {
  "name:asc": true,
  "name:desc": true,
  "vendor:asc": true,
  "vendor:desc": true,
  "amount:asc": true,
  "amount:desc": true,
  "frequency:asc": true,
  "frequency:desc": true,
  "startDate:asc": true,
  "startDate:desc": true,
  "status:asc": true,
  "status:desc": true,
};

const isExpenseSort = (value: string): value is ExpenseListSort =>
  Object.hasOwn(EXPENSE_SORTS, value);
const isRecurringSort = (value: string): value is RecurringExpenseListSort =>
  Object.hasOwn(RECURRING_SORTS, value);

/**
 * The table's parsed filter → the query of `GET /api/v1/expenses` (`api-contract.md` §3): flat facet keys, lists
 * as repeated keys. Voided expenses stay in the list (no `archived`); the BE validates every value.
 */
export function toExpenseListQuery(filter: ExpenseFilters): ExpenseListQuery {
  const query: ExpenseListQuery = { page: filter.page, pageSize: filter.pageSize };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isExpenseSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.categoryId !== undefined) query.categoryId = filter.categoryId;
  if (filter.accountId !== undefined) query.accountId = filter.accountId;
  if (filter.projectId !== undefined) query.projectId = filter.projectId;
  if (filter.currency !== undefined) query.currency = filter.currency;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  if (filter.dateFrom !== undefined) query.dateFrom = filter.dateFrom;
  if (filter.dateTo !== undefined) query.dateTo = filter.dateTo;
  if (filter.recurringOnly !== undefined) {
    query.recurringOnly = filter.recurringOnly ? "true" : "false";
  }
  return query;
}

/** Schedules filter → `GET /api/v1/recurring-expenses` query; `nextDueDate` is not a sort the BE accepts. */
export function toRecurringExpenseListQuery(
  filter: RecurringExpenseFilters,
): RecurringExpenseListQuery {
  const query: RecurringExpenseListQuery = { page: filter.page, pageSize: filter.pageSize };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isRecurringSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.categoryId !== undefined) query.categoryId = filter.categoryId;
  if (filter.frequency !== undefined) query.frequency = filter.frequency;
  return query;
}
