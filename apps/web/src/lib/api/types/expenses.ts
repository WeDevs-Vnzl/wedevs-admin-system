import type { components, operations } from "../schema";

// Generated expense DTOs and query types re-exported for the expenses module: code outside `src/lib/api/**`
// may not import the schema (ESLint, C8). Nothing here is hand-written: each type is a view of the BE document.

/** One expense (`GET|PATCH /api/v1/expenses/{id}` and the write responses). */
export type ExpenseResponseDto = components["schemas"]["ExpenseResponseDto"];
/** `GET /api/v1/expenses`: one page of table rows. */
export type ExpenseListResponseDto = components["schemas"]["ExpenseListResponseDto"];
/** One row of the expenses table. */
export type ExpenseListRowDto = ExpenseListResponseDto["items"][number];
/** `GET /api/v1/expenses` query: the flat keys of the list (`api-contract.md` §3). */
export type ExpenseListQuery = NonNullable<operations["listExpenses"]["parameters"]["query"]>;
export type ExpenseListSort = NonNullable<ExpenseListQuery["sort"]>;
/** `GET /api/v1/expenses/overview`. */
export type ExpensesOverviewDto = components["schemas"]["ExpensesOverviewDto"];

/** One recurring expense (`GET|PATCH /api/v1/recurring-expenses/{id}` and the write responses). */
export type RecurringExpenseResponseDto = components["schemas"]["RecurringExpenseResponseDto"];
/** `GET /api/v1/recurring-expenses`: one page of schedules. */
export type RecurringExpenseListResponseDto =
  components["schemas"]["RecurringExpenseListResponseDto"];
export type RecurringExpenseListQuery = NonNullable<
  operations["listRecurringExpenses"]["parameters"]["query"]
>;
export type RecurringExpenseListSort = NonNullable<RecurringExpenseListQuery["sort"]>;

/** Request bodies. */
export type CreateExpenseDto = components["schemas"]["CreateExpenseDto"];
export type UpdateExpenseDto = components["schemas"]["UpdateExpenseDto"];
export type MarkExpensePaidDto = components["schemas"]["MarkExpensePaidDto"];
export type VoidExpenseDto = components["schemas"]["VoidExpenseDto"];
export type CreateRecurringExpenseDto = components["schemas"]["CreateRecurringExpenseDto"];
export type UpdateRecurringExpenseDto = components["schemas"]["UpdateRecurringExpenseDto"];
export type SetRecurringExpenseStatusDto = components["schemas"]["SetRecurringExpenseStatusDto"];
