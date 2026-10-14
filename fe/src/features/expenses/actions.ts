"use server";

import {
  createExpenseInputSchema,
  createRecurringExpenseInputSchema,
  expenseFiltersSchema,
  markExpensePaidInputSchema,
  setRecurringExpenseStatusInputSchema,
  updateRecurringExpenseInputSchema,
  voidExpenseInputSchema,
} from "@/lib/validators/expenses";
import * as expenses from "@/mocks/services/expenses";
import { defineAction, type RevalidateTarget } from "@/server/actions/define-action";

// Server Actions of the expense module (PRD §8.8, HU-17). Each one: session → `can()` → Zod parse → service →
// revalidate → `ActionResult`. The UI hiding a button is cosmetic; these checks are the rule.

// An expense shows on the overview, the table and the shell alerts ("Gasto recurrente pendiente"), so the layouts
// are refreshed as well as the module pages.
const EXPENSE_PATHS: readonly RevalidateTarget[] = [
  { path: "/expenses", type: "layout" },
  { path: "/", type: "layout" },
];

/** The expenses table reloads its rows through this read when the URL query changes (same grant as the table). */
export const listExpensesAction = defineAction({
  permission: { action: "read", resource: "expense" },
  input: expenseFiltersSchema,
  handler: (ctx, data) => expenses.listExpenses(ctx, data),
});

export const createExpenseAction = defineAction({
  permission: { action: "create", resource: "expense" },
  input: createExpenseInputSchema,
  revalidate: EXPENSE_PATHS,
  handler: (ctx, data) => expenses.createExpense(ctx, data),
});

export const markExpensePaidAction = defineAction({
  permission: { action: "update", resource: "expense" },
  input: markExpensePaidInputSchema,
  revalidate: (data) => [...EXPENSE_PATHS, { path: `/expenses/${data.id}`, type: "page" }],
  handler: (ctx, data) => expenses.markExpensePaid(ctx, data),
});

export const voidExpenseAction = defineAction({
  permission: { action: "update", resource: "expense" },
  input: voidExpenseInputSchema,
  revalidate: (data) => [...EXPENSE_PATHS, { path: `/expenses/${data.id}`, type: "page" }],
  handler: (ctx, data) => expenses.voidExpense(ctx, data),
});

export const createRecurringExpenseAction = defineAction({
  permission: { action: "create", resource: "expense" },
  input: createRecurringExpenseInputSchema,
  revalidate: EXPENSE_PATHS,
  handler: (ctx, data) => expenses.createRecurringExpense(ctx, data),
});

export const updateRecurringExpenseAction = defineAction({
  permission: { action: "update", resource: "expense" },
  input: updateRecurringExpenseInputSchema,
  revalidate: (data) => [
    ...EXPENSE_PATHS,
    { path: `/expenses/recurring/${data.id}`, type: "page" },
  ],
  handler: (ctx, data) => expenses.updateRecurringExpense(ctx, data),
});

export const setRecurringExpenseStatusAction = defineAction({
  permission: { action: "update", resource: "expense" },
  input: setRecurringExpenseStatusInputSchema,
  revalidate: (data) => [
    ...EXPENSE_PATHS,
    { path: `/expenses/recurring/${data.id}`, type: "page" },
  ],
  handler: (ctx, data) => expenses.setRecurringExpenseStatus(ctx, data),
});
