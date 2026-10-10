import { z } from "./zod";
import {
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  withSortFields,
} from "./common";
import { expenseStatusSchema, frequencySchema, recurringStatusSchema } from "./enums";
import { fileDtoSchema } from "./files";
import { currencyCodeSchema, moneyAmountSchema, rateSchema } from "./money";
import {
  addUsdRateIssue,
  facetSchema,
  optionalText,
  requiredText,
  timestampSchema,
} from "./catalogs";
import { billingDaySchema, BILLING_MESSAGES, leadDaysSchema } from "./billing";
import { breakdownItemSchema, multiSeriesSchema, nonNegativeDecimalSchema } from "./dashboard";

/**
 * Expense contracts (PRD §8.8, §9.7): operating expenses, "mark as paid", voiding and recurring
 * expenses (day of period 1–28, lead days default 5). When an expense is paid from an account in
 * another currency, `accountAmount` (the amount debited in the account currency) is what the balance
 * uses (§9.7).
 */

export const EXPENSE_MESSAGES = {
  accountRequiredForPaid: "expenses.validation.accountRequiredForPaid",
  accountAmountRequired: "expenses.validation.accountAmountRequired",
  dueBeforeDate: "expenses.validation.dueBeforeDate",
} as const;

export const DEFAULT_RECURRING_EXPENSE_LEAD_DAYS = 5;

const amountPositive = moneyAmountSchema({ sign: "positive" });
const amountNonNegative = moneyAmountSchema({ sign: "nonNegative" });
const optionalId = idSchema.nullish().transform((value) => value ?? undefined);

/** An expense is created pending or paid; voiding goes through `voidExpense`. */
export const EXPENSE_CREATE_STATUS_VALUES = ["PENDIENTE", "PAGADO"] as const;
export const expenseCreateStatusSchema = z.enum(EXPENSE_CREATE_STATUS_VALUES);

export interface ExpenseSchemaOptions {
  /**
   * Currency of the selected payment account. When it differs from the expense currency,
   * `accountAmount` becomes required. The account is data, so the form (and the service, which looks
   * it up) pass it in.
   */
  accountCurrency?: string;
}

function checkAccountAmount(
  currency: string,
  accountAmount: string | undefined,
  options: ExpenseSchemaOptions,
  ctx: z.RefinementCtx,
): void {
  if (options.accountCurrency && options.accountCurrency !== currency && !accountAmount) {
    ctx.addIssue({
      code: "custom",
      message: EXPENSE_MESSAGES.accountAmountRequired,
      path: ["accountAmount"],
    });
  }
}

// ───────────────────────────── Expense input ─────────────────────────────

const expenseFields = {
  date: dateOnlySchema,
  /** Applies to pending expenses. */
  dueDate: dateOnlySchema.nullish().transform((value) => value ?? undefined),
  description: requiredText(300),
  /** Free text with autocomplete from previous values. */
  vendor: optionalText(120),
  categoryId: idSchema,
  /** Required to mark the expense as paid. */
  accountId: optionalId,
  projectId: optionalId,
  currency: currencyCodeSchema,
  amount: amountPositive,
  /** Amount debited in the account currency, when it differs from `currency` (§9.7). */
  accountAmount: amountPositive.nullish().transform((value) => value ?? undefined),
  usdRate: rateSchema,
  status: expenseCreateStatusSchema.default("PAGADO"),
  /** Payment date; defaults to `date` when the expense is created as paid. */
  paidAt: dateOnlySchema.nullish().transform((value) => value ?? undefined),
  receiptFileId: optionalId,
};

type ExpenseChecked = {
  date: string;
  dueDate?: string | undefined;
  currency: string;
  usdRate: string;
  status: string;
  accountId?: string | undefined;
  accountAmount?: string | undefined;
};

function checkExpense(input: ExpenseChecked, options: ExpenseSchemaOptions, ctx: z.RefinementCtx) {
  if (input.dueDate !== undefined && input.dueDate < input.date) {
    ctx.addIssue({ code: "custom", message: EXPENSE_MESSAGES.dueBeforeDate, path: ["dueDate"] });
  }
  if (input.status === "PAGADO" && input.accountId === undefined) {
    ctx.addIssue({
      code: "custom",
      message: EXPENSE_MESSAGES.accountRequiredForPaid,
      path: ["accountId"],
    });
  }
  addUsdRateIssue(ctx, input.currency, input.usdRate);
  if (input.status === "PAGADO") {
    checkAccountAmount(input.currency, input.accountAmount, options, ctx);
  }
}

export function createExpenseInputSchemaFor(options: ExpenseSchemaOptions = {}) {
  return z.object(expenseFields).superRefine((input, ctx) => checkExpense(input, options, ctx));
}

export function updateExpenseInputSchemaFor(options: ExpenseSchemaOptions = {}) {
  return z
    .object({ id: idSchema, ...expenseFields })
    .superRefine((input, ctx) => checkExpense(input, options, ctx));
}

export const createExpenseInputSchema = createExpenseInputSchemaFor();
export type CreateExpenseInput = z.infer<typeof createExpenseInputSchema>;
export const updateExpenseInputSchema = updateExpenseInputSchemaFor();
export type UpdateExpenseInput = z.infer<typeof updateExpenseInputSchema>;

/**
 * `markExpensePaid`: confirms a pending expense, adjusting the real amount, the rate and the receipt
 * (PRD §8.8). The payment account is mandatory.
 */
export function markExpensePaidInputSchemaFor(options: ExpenseSchemaOptions = {}) {
  return z
    .object({
      id: idSchema,
      accountId: idSchema,
      paidAt: dateOnlySchema,
      currency: currencyCodeSchema,
      amount: amountPositive,
      accountAmount: expenseFields.accountAmount,
      usdRate: rateSchema,
      receiptFileId: optionalId,
    })
    .superRefine((input, ctx) => {
      addUsdRateIssue(ctx, input.currency, input.usdRate);
      checkAccountAmount(input.currency, input.accountAmount, options, ctx);
    });
}
export const markExpensePaidInputSchema = markExpensePaidInputSchemaFor();
export type MarkExpensePaidInput = z.infer<typeof markExpensePaidInputSchema>;

export const voidExpenseInputSchema = z.object({ id: idSchema, reason: optionalText(500) });
export type VoidExpenseInput = z.infer<typeof voidExpenseInputSchema>;

// ───────────────────────────── Recurring expenses ─────────────────────────────

const recurringExpenseFields = {
  name: requiredText(120),
  vendor: optionalText(120),
  categoryId: idSchema,
  /** Default payment account of the generated expenses. */
  accountId: optionalId,
  projectId: optionalId,
  currency: currencyCodeSchema,
  /** Estimated amount; adjusted when each period is marked as paid. */
  amount: amountPositive,
  frequency: frequencySchema,
  /** Day of the period on which the expense falls (1–28). */
  dayOfPeriod: billingDaySchema,
  leadDays: leadDaysSchema(DEFAULT_RECURRING_EXPENSE_LEAD_DAYS),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish().transform((value) => value ?? undefined),
};

function checkRecurringDates(
  input: { startDate: string; endDate?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (input.endDate !== undefined && input.endDate < input.startDate) {
    ctx.addIssue({ code: "custom", message: BILLING_MESSAGES.endBeforeStart, path: ["endDate"] });
  }
}

export const createRecurringExpenseInputSchema = z
  .object(recurringExpenseFields)
  .superRefine(checkRecurringDates);
export type CreateRecurringExpenseInput = z.infer<typeof createRecurringExpenseInputSchema>;

export const updateRecurringExpenseInputSchema = z
  .object({ id: idSchema, ...recurringExpenseFields })
  .superRefine(checkRecurringDates);
export type UpdateRecurringExpenseInput = z.infer<typeof updateRecurringExpenseInputSchema>;

export const setRecurringExpenseStatusInputSchema = z.object({
  id: idSchema,
  status: recurringStatusSchema,
});
export type SetRecurringExpenseStatusInput = z.infer<typeof setRecurringExpenseStatusInputSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Category with its parent, so a row can show "Infraestructura → Hosting". */
export const expenseCategoryRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  nameEn: z.string().nullable(),
  parent: z.object({ id: idSchema, name: z.string(), nameEn: z.string().nullable() }).nullable(),
});
export type ExpenseCategoryRef = z.infer<typeof expenseCategoryRefSchema>;

/** Table row of expenses. */
export const expenseListRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  date: dateOnlySchema,
  dueDate: dateOnlySchema.nullable(),
  description: z.string(),
  vendor: z.string().nullable(),
  category: expenseCategoryRefSchema,
  account: entityRefSchema.nullable(),
  project: entityRefSchema.nullable(),
  currency: currencyCodeSchema,
  amount: amountPositive,
  amountUsd: amountNonNegative,
  status: expenseStatusSchema,
  /** Pending and past its due date. */
  overdue: z.boolean(),
  /** Generated by a recurring expense. */
  recurring: z.boolean(),
});
export type ExpenseListRow = z.infer<typeof expenseListRowSchema>;

export const expenseDetailDtoSchema = expenseListRowSchema.extend({
  paidAt: dateOnlySchema.nullable(),
  accountAmount: amountPositive.nullable(),
  usdRate: rateSchema,
  receiptFileId: idSchema.nullable(),
  receipt: fileDtoSchema.nullable(),
  recurringExpense: entityRefSchema.nullable(),
  periodStart: dateOnlySchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export type ExpenseDetailDTO = z.infer<typeof expenseDetailDtoSchema>;

export const recurringExpenseDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  vendor: z.string().nullable(),
  category: expenseCategoryRefSchema,
  account: entityRefSchema.nullable(),
  project: entityRefSchema.nullable(),
  currency: currencyCodeSchema,
  amount: amountPositive,
  frequency: frequencySchema,
  dayOfPeriod: z.number().int(),
  leadDays: z.number().int(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable(),
  status: recurringStatusSchema,
  lastGeneratedPeriodStart: dateOnlySchema.nullable(),
  /** Next period start still to generate; `null` when finished. */
  nextDueDate: dateOnlySchema.nullable(),
  createdAt: timestampSchema,
});
export type RecurringExpenseDTO = z.infer<typeof recurringExpenseDtoSchema>;

export const EXPENSE_SORT_FIELDS = [
  "code",
  "date",
  "dueDate",
  "description",
  "vendor",
  "amount",
  "amountUsd",
  "status",
] as const;

export const expenseFiltersSchema = withSortFields(
  listQuerySchema.extend({
    status: facetSchema(expenseStatusSchema),
    categoryId: facetSchema(idSchema),
    accountId: facetSchema(idSchema),
    projectId: facetSchema(idSchema),
    currency: facetSchema(currencyCodeSchema),
    tagId: facetSchema(idSchema),
    dateFrom: dateOnlySchema.optional(),
    dateTo: dateOnlySchema.optional(),
    /** Only the expenses generated by recurring ones. */
    recurringOnly: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
  EXPENSE_SORT_FIELDS,
);
export type ExpenseFilters = z.infer<typeof expenseFiltersSchema>;

export const RECURRING_EXPENSE_SORT_FIELDS = [
  "name",
  "vendor",
  "amount",
  "frequency",
  "startDate",
  "nextDueDate",
  "status",
] as const;

export const recurringExpenseFiltersSchema = withSortFields(
  listQuerySchema.extend({
    status: facetSchema(recurringStatusSchema),
    categoryId: facetSchema(idSchema),
    frequency: facetSchema(frequencySchema),
  }),
  RECURRING_EXPENSE_SORT_FIELDS,
);
export type RecurringExpenseFilters = z.infer<typeof recurringExpenseFiltersSchema>;

export const expensesOverviewDtoSchema = z.object({
  /** Paid spend per month (USD), stacked by root category (series id = category id). */
  byMonthAndCategory: multiSeriesSchema,
  byCategory: z.array(breakdownItemSchema),
  /** Active recurring expenses normalized to a month (USD). */
  committedMonthly: nonNegativeDecimalSchema,
  upcoming: z.array(expenseListRowSchema),
});
export type ExpensesOverviewDTO = z.infer<typeof expensesOverviewDtoSchema>;
