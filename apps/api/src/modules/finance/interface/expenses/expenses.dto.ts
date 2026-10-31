import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import {
  EXPENSE_STATUS_VALUES,
  FREQUENCY_VALUES,
  RECURRING_STATUS_VALUES,
} from '../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  moneyAmountSchema,
  rateSchema,
  timestampSchema,
} from '../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../shared/interface/list-query.dto';
import { DEFAULT_EXPENSE_SORT } from '../../application/use-cases/expenses/list-expenses.use-case';
import { DEFAULT_RECURRING_EXPENSE_SORT } from '../../application/use-cases/expenses/recurring-expense.use-cases';
import {
  DEFAULT_RECURRING_EXPENSE_LEAD_DAYS,
  EXPENSE_SORT_FIELDS,
  RECURRING_EXPENSE_SORT_FIELDS,
  type ExpenseOutput,
  type RecurringExpenseOutput,
} from '../../application/use-cases/expenses/expense-support';

/**
 * Request and response shapes of the expense routes (the FE `expenses` validators, shape only). Business rules
 * (paid needs an account, the foreign-currency debit, USD rate 1, day 1–28) are enforced by the use cases and
 * answered as `VALIDATION`, so a caller that skips the DTO meets the same rules.
 */

const amount = moneyAmountSchema({ sign: 'positive' });
const currencyCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{2,9}$/, { message: 'validation.currency.invalid' });
const optionalId = idSchema.nullish();
const expenseStatus = z.enum(EXPENSE_STATUS_VALUES);
const frequency = z.enum(FREQUENCY_VALUES);
const recurringStatus = z.enum(RECURRING_STATUS_VALUES);

export const expenseIdParamsSchema = z.object({ id: idSchema });
export class ExpenseIdParamsDto extends createZodDto(expenseIdParamsSchema) {}

/** `GET /expenses`: paging, search, sort and the facets of the table. */
export class ListExpensesQueryDto extends createListQueryDto({
  sortFields: EXPENSE_SORT_FIELDS,
  defaultSort: DEFAULT_EXPENSE_SORT,
  filters: {
    status: expenseStatus,
    categoryId: idSchema,
    accountId: idSchema,
    projectId: idSchema,
    currency: currencyCode,
    tagId: idSchema,
    dateFrom: dateOnlySchema,
    dateTo: dateOnlySchema,
    recurringOnly: z.enum(['true', 'false']),
  },
}) {}

export class ListRecurringExpensesQueryDto extends createListQueryDto({
  sortFields: RECURRING_EXPENSE_SORT_FIELDS,
  defaultSort: DEFAULT_RECURRING_EXPENSE_SORT,
  filters: { status: recurringStatus, categoryId: idSchema, frequency },
}) {}

const expenseFields = {
  date: dateOnlySchema,
  dueDate: dateOnlySchema.nullish(),
  description: z.string().max(300),
  vendor: z.string().max(120).nullish(),
  categoryId: idSchema,
  /** Required to mark the expense as paid. */
  accountId: optionalId,
  projectId: optionalId,
  currency: currencyCode,
  amount,
  /** Amount debited in the account currency, when it differs from `currency` (§9.7). */
  accountAmount: amount.nullish(),
  usdRate: rateSchema,
  receiptFileId: optionalId,
};

/** `POST /expenses`: pending or already paid. */
export const createExpenseSchema = z.object({
  ...expenseFields,
  status: z.enum(['PENDIENTE', 'PAGADO']).default('PAGADO'),
  /** Payment date; defaults to `date` when the expense is created as paid. */
  paidAt: dateOnlySchema.nullish(),
});
export class CreateExpenseDto extends createZodDto(createExpenseSchema) {}

/** `PATCH /expenses/{id}`: a pending expense only; paying goes through `/pay`. */
export class UpdateExpenseDto extends createZodDto(z.object(expenseFields)) {}

/** `POST /expenses/{id}/pay`. */
export class MarkExpensePaidDto extends createZodDto(
  z.object({
    accountId: idSchema,
    paidAt: dateOnlySchema,
    currency: currencyCode,
    amount,
    accountAmount: amount.nullish(),
    usdRate: rateSchema,
    receiptFileId: optionalId,
  }),
) {}

/** `POST /expenses/{id}/void`. */
export class VoidExpenseDto extends createZodDto(
  z.object({ reason: z.string().max(500).nullish() }),
) {}

const recurringFields = {
  name: z.string().max(120),
  vendor: z.string().max(120).nullish(),
  categoryId: idSchema,
  /** Default payment account of the generated expenses. */
  accountId: optionalId,
  projectId: optionalId,
  currency: currencyCode,
  /** Estimated amount; adjusted when each period is marked as paid. */
  amount,
  frequency,
  /** Day of the period on which the expense falls (1–28). */
  dayOfPeriod: z.number().int(),
  leadDays: z.number().int().default(DEFAULT_RECURRING_EXPENSE_LEAD_DAYS),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish(),
};
export class CreateRecurringExpenseDto extends createZodDto(z.object(recurringFields)) {}
export class UpdateRecurringExpenseDto extends createZodDto(z.object(recurringFields)) {}
export class SetRecurringExpenseStatusDto extends createZodDto(
  z.object({ status: recurringStatus }),
) {}

const categorySchema = z.object({
  id: idSchema,
  name: z.string(),
  nameEn: z.string().nullable(),
  parent: z.object({ id: idSchema, name: z.string(), nameEn: z.string().nullable() }).nullable(),
});
const refSchema = z.object(entityRefResponseSchema.shape).nullable();

export const expenseResponseSchema = z.object({
  id: idSchema,
  code: z.string(),
  date: dateOnlySchema,
  dueDate: dateOnlySchema.nullable(),
  description: z.string(),
  vendor: z.string().nullable(),
  category: categorySchema,
  account: refSchema,
  project: refSchema,
  currency: z.string(),
  amount: decimalStringSchema,
  amountUsd: decimalStringSchema,
  status: expenseStatus,
  /** Pending and past its due date. */
  overdue: z.boolean(),
  /** Generated by a recurring expense. */
  recurring: z.boolean(),
  paidAt: dateOnlySchema.nullable(),
  accountAmount: decimalStringSchema.nullable(),
  usdRate: decimalStringSchema,
  receiptFileId: idSchema.nullable(),
  recurringExpense: refSchema,
  periodStart: dateOnlySchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export class ExpenseResponseDto extends createZodDto(expenseResponseSchema) {}

const listEnvelope = {
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
};
export class ExpenseListResponseDto extends createZodDto(
  z.object({ items: z.array(expenseResponseSchema), ...listEnvelope }),
) {}

export const recurringExpenseResponseSchema = z.object({
  id: idSchema,
  name: z.string(),
  vendor: z.string().nullable(),
  category: categorySchema,
  account: refSchema,
  project: refSchema,
  currency: z.string(),
  amount: decimalStringSchema,
  frequency,
  dayOfPeriod: z.number().int(),
  leadDays: z.number().int(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable(),
  status: recurringStatus,
  lastGeneratedPeriodStart: dateOnlySchema.nullable(),
  /** Day of the last resume; the daily step skips the periods whose generation day fell before it. */
  resumedOn: dateOnlySchema.nullable(),
  /** Next period start still to generate; `null` when finished. */
  nextDueDate: dateOnlySchema.nullable(),
  /** USD snapshot of the last save (Δ10). */
  usdRate: decimalStringSchema,
  monthlyAmountUsd: decimalStringSchema,
  createdAt: timestampSchema,
});
export class RecurringExpenseResponseDto extends createZodDto(recurringExpenseResponseSchema) {}
export class RecurringExpenseListResponseDto extends createZodDto(
  z.object({ items: z.array(recurringExpenseResponseSchema), ...listEnvelope }),
) {}

const refOf = (ref: EntityRef | null) =>
  ref ? { type: ref.type, id: ref.id, code: ref.code ?? null, label: ref.label } : null;

export function toExpenseResponse(output: ExpenseOutput): z.infer<typeof expenseResponseSchema> {
  return {
    id: output.id,
    code: output.code,
    date: output.date,
    dueDate: output.dueDate,
    description: output.description,
    vendor: output.vendor,
    category: output.category,
    account: refOf(output.account),
    project: refOf(output.project),
    currency: output.currency,
    amount: output.amount,
    amountUsd: output.amountUsd,
    status: output.status,
    overdue: output.overdue,
    recurring: output.recurring,
    paidAt: output.paidAt,
    accountAmount: output.accountAmount,
    usdRate: output.usdRate,
    receiptFileId: output.receiptFileId,
    recurringExpense: refOf(output.recurringExpense),
    periodStart: output.periodStart,
    createdAt: output.createdAt,
    updatedAt: output.updatedAt,
    createdById: output.createdById,
  };
}

export function toRecurringExpenseResponse(
  output: RecurringExpenseOutput,
): z.infer<typeof recurringExpenseResponseSchema> {
  return {
    id: output.id,
    name: output.name,
    vendor: output.vendor,
    category: output.category,
    account: refOf(output.account),
    project: refOf(output.project),
    currency: output.currency,
    amount: output.amount,
    frequency: output.frequency,
    dayOfPeriod: output.dayOfPeriod,
    leadDays: output.leadDays,
    startDate: output.startDate,
    endDate: output.endDate,
    status: output.status,
    lastGeneratedPeriodStart: output.lastGeneratedPeriodStart,
    resumedOn: output.resumedOn,
    nextDueDate: output.nextDueDate,
    usdRate: output.usdRate,
    monthlyAmountUsd: output.monthlyAmountUsd,
    createdAt: output.createdAt,
  };
}
