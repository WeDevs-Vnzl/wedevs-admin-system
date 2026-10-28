import "server-only";
import { idSchema } from "@/lib/validators/common";
import { expenseFiltersSchema, type ExpenseFiltersInput } from "@/lib/validators/expenses";
import * as expenses from "@/mocks/services/expenses";
import { can } from "@/server/auth/permissions";
import { getServiceContext, ServiceError } from "@/server/context";

// Reads for the expense pages (RSC, PRD §8.8). The `read` grant on `expense` (Owner and Admin) is checked before the
// service runs; a missing expense is a `NOT_FOUND` that the page turns into `notFound()`.

async function readContext() {
  const ctx = await getServiceContext();
  if (!can(ctx.user, "read", "expense")) throw new ServiceError("FORBIDDEN");
  return ctx;
}

export async function getExpensesOverview() {
  return expenses.getExpensesOverview(await readContext());
}

/** The table's first page: the URL query parsed with the same filter schema as `listExpensesAction`. */
export async function listExpenses(input: ExpenseFiltersInput = {}) {
  return expenses.listExpenses(await readContext(), expenseFiltersSchema.parse(input));
}

export async function getExpense(id: string) {
  return expenses.getExpense(await readContext(), idSchema.parse(id));
}

export async function listRecurringExpenses(input: { q?: string; pageSize?: 25 | 50 | 100 } = {}) {
  return expenses.listRecurringExpenses(await readContext(), input);
}

export async function getRecurringExpense(id: string) {
  return expenses.getRecurringExpense(await readContext(), idSchema.parse(id));
}
