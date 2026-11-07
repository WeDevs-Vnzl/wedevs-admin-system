"use server";

import { apiAction, type RevalidateTarget } from "@/lib/api/action";
import type {
  CreateExpenseDto,
  CreateRecurringExpenseDto,
  ExpenseListResponseDto,
  ExpenseResponseDto,
  MarkExpensePaidDto,
  RecurringExpenseResponseDto,
  SetRecurringExpenseStatusDto,
  UpdateExpenseDto,
  UpdateRecurringExpenseDto,
  VoidExpenseDto,
} from "@/lib/api/types/expenses";
import {
  entityRefSchema,
  errorMessageKey,
  type ActionResult,
  type EntityRef,
} from "@/lib/validators/common";
import {
  expenseFiltersSchema,
  searchExpensesInputSchema,
  type ExpenseFiltersInput,
  type SearchExpensesInput,
} from "@/lib/validators/expenses";
import { toExpenseListQuery } from "./api-query";

// Thin API proxies (C10, PRD §8.8, HU-17): token → one BE call → error mapping → revalidate. The BE decides every
// grant and every money rule (the debit in the account currency, the USD snapshot); the FE never checks `can()`
// or computes an amount here. Amounts travel as decimal strings (C15).

// An expense shows on the overview, the table and the shell alerts ("Gasto recurrente pendiente"), so the layouts
// are refreshed as well as the module pages.
const EXPENSE_PATHS: readonly RevalidateTarget[] = [
  { path: "/expenses", type: "layout" },
  { path: "/", type: "layout" },
];
const expensePage = (id: string): RevalidateTarget => ({ path: `/expenses/${id}`, type: "page" });
const recurringPage = (id: string): RevalidateTarget => ({
  path: `/expenses/recurring/${id}`,
  type: "page",
});

// The forms validate for UX and hand over the parsed values; the commands take the BE's own body types (C8),
// plus the id the path needs.
type UpdateExpenseInput = UpdateExpenseDto & { id: string };
type MarkExpensePaidInput = MarkExpensePaidDto & { id: string };
type VoidExpenseInput = VoidExpenseDto & { id: string };
type UpdateRecurringExpenseInput = UpdateRecurringExpenseDto & { id: string };
type SetRecurringExpenseStatusInput = SetRecurringExpenseStatusDto & { id: string };

const listExpenses = apiAction<ExpenseFiltersInput, ExpenseListResponseDto>({
  call: (input, api) =>
    api.GET("/api/v1/expenses", {
      params: { query: toExpenseListQuery(expenseFiltersSchema.parse(input)) },
    }),
});

/**
 * The expenses table reloads its rows through this read when the URL query changes. The filter is checked for UX
 * only (a bad sort never leaves the FE); the BE re-validates and decides who may read.
 */
export async function listExpensesAction(
  input: ExpenseFiltersInput,
): Promise<ActionResult<ExpenseListResponseDto>> {
  if (!expenseFiltersSchema.safeParse(input).success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listExpenses(input);
}

export const createExpenseAction = apiAction<CreateExpenseDto, ExpenseResponseDto>({
  call: (input, api) => api.POST("/api/v1/expenses", { body: input }),
  revalidate: EXPENSE_PATHS,
});

/** Edit a pending expense (Q-FEINT-11 (A)); the BE answers the mapped `CONFLICT` `expenses.errors.notPending` otherwise. */
export const updateExpenseAction = apiAction<UpdateExpenseInput, ExpenseResponseDto>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/expenses/{id}", { params: { path: { id } }, body }),
  revalidate: (input) => [...EXPENSE_PATHS, expensePage(input.id)],
});

/**
 * Pay a pending expense. Paying from an account in another currency debits `accountAmount` as the user typed it;
 * the response carries what the BE stored (C16).
 */
export const markExpensePaidAction = apiAction<MarkExpensePaidInput, ExpenseResponseDto>({
  call: ({ id, ...body }, api) =>
    api.POST("/api/v1/expenses/{id}/pay", { params: { path: { id } }, body }),
  revalidate: (input) => [...EXPENSE_PATHS, expensePage(input.id)],
});

export const voidExpenseAction = apiAction<VoidExpenseInput, ExpenseResponseDto>({
  call: ({ id, ...body }, api) =>
    api.POST("/api/v1/expenses/{id}/void", { params: { path: { id } }, body }),
  revalidate: (input) => [...EXPENSE_PATHS, expensePage(input.id)],
});

export const createRecurringExpenseAction = apiAction<
  CreateRecurringExpenseDto,
  RecurringExpenseResponseDto
>({
  call: (input, api) => api.POST("/api/v1/recurring-expenses", { body: input }),
  revalidate: EXPENSE_PATHS,
});

export const updateRecurringExpenseAction = apiAction<
  UpdateRecurringExpenseInput,
  RecurringExpenseResponseDto
>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/recurring-expenses/{id}", { params: { path: { id } }, body }),
  revalidate: (input) => [...EXPENSE_PATHS, recurringPage(input.id)],
});

export const setRecurringExpenseStatusAction = apiAction<
  SetRecurringExpenseStatusInput,
  RecurringExpenseResponseDto
>({
  call: ({ id, ...body }, api) =>
    api.POST("/api/v1/recurring-expenses/{id}/status", { params: { path: { id } }, body }),
  revalidate: (input) => [...EXPENSE_PATHS, recurringPage(input.id)],
});

const searchExpenses = apiAction<{ q: string }, ExpenseListResponseDto>({
  call: ({ q }, api) =>
    api.GET("/api/v1/expenses", { params: { query: { ...(q ? { q } : {}), pageSize: 25 } } }),
});

/**
 * Async expense combobox of the note link picker and the document links (frozen): the BE has no
 * `/expenses/search`, so this reads the list route with `q`, keeps the first 20 rows and returns them as
 * `EntityRef`s (rule 12).
 */
export async function searchExpensesAction(
  input: SearchExpensesInput,
): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchExpensesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await searchExpenses(parsed.data);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items.slice(0, 20).map((row) =>
      entityRefSchema.parse({
        type: "EXPENSE",
        id: row.id,
        code: row.code,
        label: row.description,
      }),
    ),
  };
}
