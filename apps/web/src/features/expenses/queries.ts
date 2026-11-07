import "server-only";
import { toActionResult, type ApiResponseLike } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import { idSchema } from "@/lib/validators/common";
import {
  expenseFiltersSchema,
  recurringExpenseFiltersSchema,
  type ExpenseFiltersInput,
  type RecurringExpenseFiltersInput,
} from "@/lib/validators/expenses";
import { ServiceError } from "@/lib/service-error";
import { toExpenseListQuery, toRecurringExpenseListQuery } from "./api-query";

// Reads for the expense pages (RSC, PRD §8.8) over the generated client. A refused read throws `ServiceError` with
// the BE's code (`404` → NOT_FOUND, `403` → FORBIDDEN, `422` → VALIDATION), the contract the pages catch.

/** Unwraps a read or throws the BE's code as a `ServiceError`. */
function unwrap<T>(response: ApiResponseLike<T>): T {
  const result = toActionResult(response);
  if (result.ok) return result.data;
  throw new ServiceError(result.error.code, {
    message: result.error.message,
    ...(result.error.fieldErrors ? { fieldErrors: result.error.fieldErrors } : {}),
  });
}

/** `GET /api/v1/expenses/overview` (DT-175): `FORBIDDEN` without the expense read grant. */
export async function getExpensesOverview() {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/expenses/overview"));
}

/** The table's first page: the URL query parsed with the same filter schema as `listExpensesAction`. */
export async function listExpenses(input: ExpenseFiltersInput = {}) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/expenses", {
      params: { query: toExpenseListQuery(expenseFiltersSchema.parse(input)) },
    }),
  );
}

export async function getExpense(id: string) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/expenses/{id}", { params: { path: { id: idSchema.parse(id) } } }),
  );
}

export async function listRecurringExpenses(input: RecurringExpenseFiltersInput = {}) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/recurring-expenses", {
      params: { query: toRecurringExpenseListQuery(recurringExpenseFiltersSchema.parse(input)) },
    }),
  );
}

export async function getRecurringExpense(id: string) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/recurring-expenses/{id}", {
      params: { path: { id: idSchema.parse(id) } },
    }),
  );
}
