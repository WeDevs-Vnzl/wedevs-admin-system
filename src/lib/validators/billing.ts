import { z } from "./zod";
import { dateOnlySchema, idSchema, VALIDATION_MESSAGES } from "./common";
import {
  billingModelSchema,
  frequencySchema,
  installmentKindSchema,
  installmentStatusSchema,
  recurringStatusSchema,
} from "./enums";
import { currencyCodeSchema, moneyAmountSchema, percentSchema, rateSchema } from "./money";
import { optionalText, requiredText, timestampSchema } from "./catalogs";
import { isZeroMoney } from "../money";

/**
 * Billing-scheme contracts (PRD §8.4): billing plan, installments, quick templates, recurring charges
 * and the project financial summary. Amounts are decimal strings (C15); the sums, splits and statuses
 * are computed in `lib/finance` (C17), never here.
 */

export const BILLING_MESSAGES = {
  billingDayRange: "billing.validation.billingDayRange",
  leadDaysRange: "billing.validation.leadDaysRange",
  contractAmountRequired: "billing.validation.contractAmountRequired",
  customInstallmentsRequired: "billing.validation.customInstallmentsRequired",
  templateInstallmentsNotAllowed: "billing.validation.templateInstallmentsNotAllowed",
  endBeforeStart: "billing.validation.endBeforeStart",
  adjustmentNonZero: "billing.validation.adjustmentNonZero",
  installmentKindNotManual: "billing.validation.installmentKindNotManual",
  nothingToUpdate: "billing.validation.nothingToUpdate",
} as const;

const amountAny = moneyAmountSchema({ sign: "any" });
const amountPositive = moneyAmountSchema({ sign: "positive" });

/** Billing day / period day: 1–28 so every month has it (PRD §8.4.3, CHECK `rc_billing_day`). */
export const billingDaySchema = z
  .number()
  .int(BILLING_MESSAGES.billingDayRange)
  .min(1, BILLING_MESSAGES.billingDayRange)
  .max(28, BILLING_MESSAGES.billingDayRange);

/** Days before the period when the installment/expense is generated. */
export function leadDaysSchema(defaultValue: number) {
  return z
    .number()
    .int(BILLING_MESSAGES.leadDaysRange)
    .min(0, BILLING_MESSAGES.leadDaysRange)
    .max(60, BILLING_MESSAGES.leadDaysRange)
    .default(defaultValue);
}

export const DEFAULT_RECURRING_LEAD_DAYS = 7;

// ───────────────────────────── Quick templates (PRD §8.4.2) ─────────────────────────────

export const INSTALLMENT_TEMPLATE_VALUES = [
  "FULL_UPFRONT",
  "SPLIT_50_50",
  "SPLIT_40_30_30",
  "SPLIT_30_40_30",
  "THREE_EQUAL",
  "CUSTOM",
] as const;
export const installmentTemplateSchema = z.enum(INSTALLMENT_TEMPLATE_VALUES);
export type InstallmentTemplate = z.infer<typeof installmentTemplateSchema>;

/**
 * Percentages each template generates, in order (they add up to 100; the last absorbs the remainder
 * of an equal split). `CUSTOM` generates nothing: the caller supplies the installments. Labels come
 * from `billing.templates.<TEMPLATE>`.
 */
export const INSTALLMENT_TEMPLATE_PERCENTAGES: Record<InstallmentTemplate, readonly string[]> = {
  FULL_UPFRONT: ["100"],
  SPLIT_50_50: ["50", "50"],
  SPLIT_40_30_30: ["40", "30", "30"],
  SPLIT_30_40_30: ["30", "40", "30"],
  THREE_EQUAL: ["33.33", "33.33", "33.34"],
  CUSTOM: [],
};

// ───────────────────────────── Billing plan ─────────────────────────────

export const upsertBillingPlanInputSchema = z
  .object({
    projectId: idSchema,
    model: billingModelSchema,
    currency: currencyCodeSchema,
    /** Contracted amount: required for fixed-price and mixed plans. */
    contractAmount: amountPositive.nullish().transform((value) => value ?? undefined),
    notes: optionalText(2000),
  })
  .superRefine((input, ctx) => {
    if (input.model !== "RECURRENTE" && input.contractAmount === undefined) {
      ctx.addIssue({
        code: "custom",
        message: BILLING_MESSAGES.contractAmountRequired,
        path: ["contractAmount"],
      });
    }
  });
export type UpsertBillingPlanInput = z.infer<typeof upsertBillingPlanInputSchema>;

// ───────────────────────────── Installments ─────────────────────────────

const installmentFields = {
  label: requiredText(120),
  amount: amountAny,
  currency: currencyCodeSchema,
  /** When set, the amount is that percentage of the contracted amount. */
  percentage: percentSchema.nullish().transform((value) => value ?? undefined),
  dueDate: dateOnlySchema.nullish().transform((value) => value ?? undefined),
  /** Free-text condition, e.g. "On design approval". */
  trigger: optionalText(200),
  order: z.number().int().min(0).max(999).optional(),
};

/** Manual installments: `RECURRENTE` ones are generated from a recurring charge only. */
export const manualInstallmentKindSchema = installmentKindSchema.refine(
  (kind) => kind !== "RECURRENTE",
  { message: BILLING_MESSAGES.installmentKindNotManual },
);

/** An installment draft inside a plan operation (no project: it takes the plan's). */
export const installmentDraftSchema = z
  .object({ kind: manualInstallmentKindSchema, ...installmentFields })
  .superRefine((input, ctx) => checkInstallmentAmount(input.kind, input.amount, ctx));
export type InstallmentDraft = z.infer<typeof installmentDraftSchema>;

/** Only `AJUSTE` may be negative (scope change); every other kind is a positive amount. */
function checkInstallmentAmount(kind: string, amount: string, ctx: z.RefinementCtx): void {
  if (!amountAny.safeParse(amount).success) return;
  if (kind === "AJUSTE") {
    if (isZeroMoney(amount)) {
      ctx.addIssue({
        code: "custom",
        message: BILLING_MESSAGES.adjustmentNonZero,
        path: ["amount"],
      });
    }
    return;
  }
  const positive = amountPositive.safeParse(amount);
  if (!positive.success) {
    ctx.addIssue({
      code: "custom",
      message: VALIDATION_MESSAGES.moneyMustBePositive,
      path: ["amount"],
    });
  }
}

export const createInstallmentInputSchema = z
  .object({ projectId: idSchema, kind: manualInstallmentKindSchema, ...installmentFields })
  .superRefine((input, ctx) => checkInstallmentAmount(input.kind, input.amount, ctx));
export type CreateInstallmentInput = z.infer<typeof createInstallmentInputSchema>;

/**
 * Partial update. A billed installment only accepts a new label (INTEGRITY_LOCK otherwise, enforced
 * by the service, C19); `kind` never changes.
 */
export const updateInstallmentInputSchema = z
  .object({
    id: idSchema,
    label: installmentFields.label.optional(),
    amount: amountAny.optional(),
    currency: currencyCodeSchema.optional(),
    percentage: installmentFields.percentage,
    dueDate: installmentFields.dueDate,
    trigger: installmentFields.trigger,
    order: installmentFields.order,
  })
  .superRefine((input, ctx) => {
    const changes = [
      input.label,
      input.amount,
      input.currency,
      input.percentage,
      input.dueDate,
      input.trigger,
      input.order,
    ];
    if (changes.every((value) => value === undefined)) {
      ctx.addIssue({ code: "custom", message: BILLING_MESSAGES.nothingToUpdate });
    }
  });
export type UpdateInstallmentInput = z.infer<typeof updateInstallmentInputSchema>;

export const cancelInstallmentInputSchema = z.object({ id: idSchema });
export type CancelInstallmentInput = z.infer<typeof cancelInstallmentInputSchema>;

export const recomputeInstallmentStatusInputSchema = z.object({ id: idSchema });
export type RecomputeInstallmentStatusInput = z.infer<typeof recomputeInstallmentStatusInputSchema>;

/**
 * `applyInstallmentTemplate`: a fixed template generates its installments from the contracted
 * amount; `CUSTOM` requires the installments to be supplied. The generated installments can then be
 * edited freely (PRD §8.4.2).
 */
export const applyInstallmentTemplateInputSchema = z
  .object({
    projectId: idSchema,
    template: installmentTemplateSchema,
    /** Replace the not-yet-billed installments of the plan (default) or append to them. */
    replacePending: z.boolean().default(true),
    installments: z.array(installmentDraftSchema).max(60).optional(),
  })
  .superRefine((input, ctx) => {
    const supplied = (input.installments?.length ?? 0) > 0;
    if (input.template === "CUSTOM" && !supplied) {
      ctx.addIssue({
        code: "custom",
        message: BILLING_MESSAGES.customInstallmentsRequired,
        path: ["installments"],
      });
    }
    if (input.template !== "CUSTOM" && supplied) {
      ctx.addIssue({
        code: "custom",
        message: BILLING_MESSAGES.templateInstallmentsNotAllowed,
        path: ["installments"],
      });
    }
  });
export type ApplyInstallmentTemplateInput = z.infer<typeof applyInstallmentTemplateInputSchema>;

export const installmentDtoSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  billingPlanId: idSchema.nullable(),
  recurringChargeId: idSchema.nullable(),
  kind: installmentKindSchema,
  label: z.string(),
  amount: amountAny,
  currency: currencyCodeSchema,
  percentage: percentSchema.nullable(),
  dueDate: dateOnlySchema.nullable(),
  trigger: z.string().nullable(),
  periodStart: dateOnlySchema.nullable(),
  periodEnd: dateOnlySchema.nullable(),
  order: z.number().int(),
  status: installmentStatusSchema,
  cancelledAt: timestampSchema.nullable(),
  /** Sum of the non-void invoice lines that reference it, in the installment currency. */
  invoicedAmount: moneyAmountSchema({ sign: "nonNegative" }),
  /** Billed installments cannot change amount or currency (C19); the UI disables those fields. */
  locked: z.boolean(),
});
export type InstallmentDTO = z.infer<typeof installmentDtoSchema>;

export const billingPlanDtoSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  model: billingModelSchema,
  currency: currencyCodeSchema,
  contractAmount: moneyAmountSchema({ sign: "positive" }).nullable(),
  notes: z.string().nullable(),
  installments: z.array(installmentDtoSchema),
  /** Sum of the non-`AJUSTE` installments (PRD §8.4.2 sum validation). */
  installmentsTotal: amountAny,
  /** Contract amount minus `installmentsTotal`; `null` for plans without a contract amount. */
  scheduleDifference: amountAny.nullable(),
  /** False when the difference exceeds ±0.01: a persistent, non-blocking warning. */
  scheduleConsistent: z.boolean(),
  /** D1 snapshot: the contract in USD, taken at plan save and never recomputed (C16); `null` without a contract. */
  contractedUsd: moneyAmountSchema({ sign: "positive" }).nullable(),
  /** Rate of the day of the save (`"1"` for USD); `null` when no rate was available for a plan without contract. */
  usdRate: rateSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type BillingPlanDTO = z.infer<typeof billingPlanDtoSchema>;

// ───────────────────────────── Recurring charges (PRD §8.4.3) ─────────────────────────────

const recurringChargeFields = {
  label: requiredText(120),
  amount: amountPositive,
  currency: currencyCodeSchema,
  frequency: frequencySchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish().transform((value) => value ?? undefined),
  billingDay: billingDaySchema,
  leadDays: leadDaysSchema(DEFAULT_RECURRING_LEAD_DAYS),
};

function checkEndAfterStart(
  input: { startDate: string; endDate?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (input.endDate !== undefined && input.endDate < input.startDate) {
    ctx.addIssue({ code: "custom", message: BILLING_MESSAGES.endBeforeStart, path: ["endDate"] });
  }
}

export const createRecurringChargeInputSchema = z
  .object({ projectId: idSchema, ...recurringChargeFields })
  .superRefine(checkEndAfterStart);
export type CreateRecurringChargeInput = z.infer<typeof createRecurringChargeInputSchema>;

/** Changing the amount only affects future periods (service rule). */
export const updateRecurringChargeInputSchema = z
  .object({ id: idSchema, ...recurringChargeFields })
  .superRefine(checkEndAfterStart);
export type UpdateRecurringChargeInput = z.infer<typeof updateRecurringChargeInputSchema>;

export const setRecurringChargeStatusInputSchema = z.object({
  id: idSchema,
  status: recurringStatusSchema,
});
export type SetRecurringChargeStatusInput = z.infer<typeof setRecurringChargeStatusInputSchema>;

/** "Generate missing periods": periods skipped while paused are created only on request. */
export const generateMissingPeriodsInputSchema = z.object({
  recurringChargeId: idSchema,
  /** Last date to generate up to; defaults to today plus the lead days. */
  upTo: dateOnlySchema.optional(),
});
export type GenerateMissingPeriodsInput = z.infer<typeof generateMissingPeriodsInputSchema>;

export const generateMissingPeriodsResultSchema = z.object({
  created: z.number().int().nonnegative(),
  periodStarts: z.array(dateOnlySchema),
});
export type GenerateMissingPeriodsResult = z.infer<typeof generateMissingPeriodsResultSchema>;

export const recurringChargeDtoSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  label: z.string(),
  amount: amountPositive,
  currency: currencyCodeSchema,
  frequency: frequencySchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable(),
  billingDay: z.number().int(),
  leadDays: z.number().int(),
  status: recurringStatusSchema,
  lastGeneratedPeriodStart: dateOnlySchema.nullable(),
  /** Business day of the last resume after a pause: the daily job skips the periods due before it (PRD §8.4.3). */
  resumedOn: dateOnlySchema.nullable(),
  /** Amount normalized to a month, in the charge currency (quarterly ÷ 3, …); computed in `lib/finance`. */
  monthlyAmount: amountPositive,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type RecurringChargeDTO = z.infer<typeof recurringChargeDtoSchema>;

// ───────────────────────────── Project financial summary (PRD §8.4.4) ─────────────────────────────

/** Every figure is USD from the stored snapshots (C16). */
export const projectFinancialSummarySchema = z.object({
  projectId: idSchema,
  currency: z.literal("USD"),
  /** Contracted amount plus adjustments. */
  contractedValue: amountAny,
  invoiced: moneyAmountSchema({ sign: "nonNegative" }),
  collected: moneyAmountSchema({ sign: "nonNegative" }),
  /** Contracted value − invoiced; only for fixed-price and mixed plans, else `null`. */
  toInvoice: amountAny.nullable(),
  /** Invoiced − collected. */
  receivable: amountAny,
  /** Active recurring charges normalized to a month. */
  monthlyRecurring: moneyAmountSchema({ sign: "nonNegative" }),
  allocatedExpenses: moneyAmountSchema({ sign: "nonNegative" }),
  /** Collected − allocated expenses. */
  margin: amountAny,
  /** Margin ÷ collected as a percentage; `null` while nothing is collected. */
  marginPercent: amountAny.nullable(),
});
export type ProjectFinancialSummary = z.infer<typeof projectFinancialSummarySchema>;
