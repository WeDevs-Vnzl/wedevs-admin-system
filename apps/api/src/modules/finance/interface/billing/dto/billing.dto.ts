import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  BILLING_MODEL_VALUES,
  FREQUENCY_VALUES,
  INSTALLMENT_KIND_VALUES,
  INSTALLMENT_STATUS_VALUES,
  RECURRING_STATUS_VALUES,
} from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  moneyAmountSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import {
  BILLING_MESSAGES,
  DEFAULT_RECURRING_LEAD_DAYS,
  INSTALLMENT_TEMPLATE_VALUES,
  MAX_CUSTOM_INSTALLMENTS,
} from '../../../application/use-cases/billing/billing-support';
import type { BillingPageView } from '../../../application/use-cases/billing/billing-support';

/**
 * Request and response shapes of the billing routes (PRD §8.4; the FE `billing` validators). Money is a
 * decimal string (C15). The shape rules are repeated by the use cases for callers that skip the DTO.
 */

const amountAny = moneyAmountSchema({ sign: 'any' });
const amountPositive = moneyAmountSchema({ sign: 'positive' });
const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{2,9}$/, { message: BILLING_MESSAGES.invalidCurrency });
const percentSchema = z
  .string()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/, { message: BILLING_MESSAGES.invalidMoney });
const billingModelSchema = z.enum(BILLING_MODEL_VALUES);
const frequencySchema = z.enum(FREQUENCY_VALUES);
const installmentKindSchema = z.enum(INSTALLMENT_KIND_VALUES);
const recurringStatusSchema = z.enum(RECURRING_STATUS_VALUES);
const templateSchema = z.enum(INSTALLMENT_TEMPLATE_VALUES);
const labelSchema = z.string().trim().min(1, BILLING_MESSAGES.required).max(120);
const triggerSchema = z.string().max(200);
const billingDaySchema = z
  .number()
  .int(BILLING_MESSAGES.billingDayRange)
  .min(1, BILLING_MESSAGES.billingDayRange)
  .max(28, BILLING_MESSAGES.billingDayRange);
const leadDaysSchema = z
  .number()
  .int(BILLING_MESSAGES.leadDaysRange)
  .min(0, BILLING_MESSAGES.leadDaysRange)
  .max(60, BILLING_MESSAGES.leadDaysRange);

export const idParamsSchema = z.object({ id: idSchema });
export class BillingIdParamsDto extends createZodDto(idParamsSchema) {}

// ───────────────────────────── Requests ─────────────────────────────

export const upsertBillingPlanSchema = z.object({
  model: billingModelSchema,
  currency: currencyCodeSchema,
  /** Contracted amount: required for fixed-price and mixed plans (the use case enforces it). */
  contractAmount: amountPositive.nullish(),
  notes: z.string().max(2000).nullish(),
});
export class UpsertBillingPlanDto extends createZodDto(upsertBillingPlanSchema) {}

const installmentFields = {
  label: labelSchema,
  amount: amountAny,
  currency: currencyCodeSchema,
  /** When set, the amount is that percentage of the contracted amount. */
  percentage: percentSchema.nullish(),
  dueDate: dateOnlySchema.nullish(),
  /** Free-text condition, e.g. "On design approval". */
  trigger: triggerSchema.nullish(),
};

/** Manual installments: `RECURRENTE` ones are generated from a recurring charge only. */
const manualKindSchema = installmentKindSchema.refine((kind) => kind !== 'RECURRENTE', {
  message: BILLING_MESSAGES.installmentKindNotManual,
});

export const installmentDraftSchema = z.object({ kind: manualKindSchema, ...installmentFields });

export const applyInstallmentTemplateSchema = z.object({
  template: templateSchema,
  /** Replace the not-yet-billed installments of the plan (default) or append to them. */
  replacePending: z.boolean().default(true),
  installments: z.array(installmentDraftSchema).max(MAX_CUSTOM_INSTALLMENTS).optional(),
});
export class ApplyInstallmentTemplateDto extends createZodDto(applyInstallmentTemplateSchema) {}

export const createInstallmentSchema = z.object({
  kind: manualKindSchema,
  ...installmentFields,
  order: z.number().int().min(0).max(999).optional(),
});
export class CreateInstallmentDto extends createZodDto(createInstallmentSchema) {}

export const updateInstallmentSchema = z.object({
  label: labelSchema.optional(),
  amount: amountAny.optional(),
  currency: currencyCodeSchema.optional(),
  percentage: percentSchema.nullish(),
  dueDate: dateOnlySchema.nullish(),
  trigger: triggerSchema.nullish(),
  order: z.number().int().min(0).max(999).optional(),
});
export class UpdateInstallmentDto extends createZodDto(updateInstallmentSchema) {}

const recurringChargeFields = {
  label: labelSchema,
  amount: amountPositive,
  currency: currencyCodeSchema,
  frequency: frequencySchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullish(),
  billingDay: billingDaySchema,
  leadDays: leadDaysSchema.default(DEFAULT_RECURRING_LEAD_DAYS),
};

export const createRecurringChargeSchema = z.object(recurringChargeFields);
export class CreateRecurringChargeDto extends createZodDto(createRecurringChargeSchema) {}

/** Changing the amount only affects future periods (use case rule). */
export const updateRecurringChargeSchema = z.object(recurringChargeFields);
export class UpdateRecurringChargeDto extends createZodDto(updateRecurringChargeSchema) {}

export const setRecurringChargeStatusSchema = z.object({ status: recurringStatusSchema });
export class SetRecurringChargeStatusDto extends createZodDto(setRecurringChargeStatusSchema) {}

export const generateMissingPeriodsSchema = z.object({
  /** Last date to generate up to; defaults to today plus the lead days. */
  upTo: dateOnlySchema.optional(),
});
export class GenerateMissingPeriodsDto extends createZodDto(generateMissingPeriodsSchema) {}

// ───────────────────────────── Responses ─────────────────────────────

export const installmentResponseSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  billingPlanId: idSchema.nullable(),
  recurringChargeId: idSchema.nullable(),
  kind: installmentKindSchema,
  label: z.string(),
  amount: decimalStringSchema,
  currency: z.string(),
  percentage: decimalStringSchema.nullable(),
  dueDate: dateOnlySchema.nullable(),
  trigger: z.string().nullable(),
  periodStart: dateOnlySchema.nullable(),
  periodEnd: dateOnlySchema.nullable(),
  order: z.number().int(),
  status: z.enum(INSTALLMENT_STATUS_VALUES),
  cancelledAt: timestampSchema.nullable(),
  /** Sum of the live invoice lines that reference it, in the installment currency. */
  invoicedAmount: decimalStringSchema,
  /** Billed installments cannot change amount or currency (C19). */
  locked: z.boolean(),
});

export const billingPlanResponseSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  model: billingModelSchema,
  currency: z.string(),
  contractAmount: decimalStringSchema.nullable(),
  notes: z.string().nullable(),
  installments: z.array(installmentResponseSchema),
  /** Sum of the non-`AJUSTE`, non-cancelled installments (PRD §8.4.2 sum validation). */
  installmentsTotal: decimalStringSchema,
  /** Installments minus contract when it exceeds ±0.01; `null` when consistent. */
  scheduleDifference: decimalStringSchema.nullable(),
  /** False when the difference exceeds ±0.01: a persistent, non-blocking warning. */
  scheduleConsistent: z.boolean(),
  /** D1 snapshot of the contract in USD, taken at plan save and never recomputed (C16). */
  contractedUsd: decimalStringSchema.nullable(),
  usdRate: decimalStringSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const recurringChargeResponseSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  label: z.string(),
  amount: decimalStringSchema,
  currency: z.string(),
  frequency: frequencySchema,
  startDate: dateOnlySchema,
  endDate: dateOnlySchema.nullable(),
  billingDay: z.number().int(),
  leadDays: z.number().int(),
  status: recurringStatusSchema,
  lastGeneratedPeriodStart: dateOnlySchema.nullable(),
  /** Business day of the last resume: the daily step skips the periods due before it. */
  resumedOn: dateOnlySchema.nullable(),
  /** Amount normalized to a month in the charge currency (quarterly ÷ 3, …). */
  monthlyAmount: decimalStringSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const billingPageResponseSchema = z.object({
  projectId: idSchema,
  plan: billingPlanResponseSchema.nullable(),
  installments: z.array(installmentResponseSchema),
  recurringCharges: z.array(recurringChargeResponseSchema),
});
export class BillingPageResponseDto extends createZodDto(billingPageResponseSchema) {}

export const generateMissingPeriodsResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  periodStarts: z.array(dateOnlySchema),
});
export class GenerateMissingPeriodsResponseDto extends createZodDto(
  generateMissingPeriodsResponseSchema,
) {}

/** Output mapping: the application view already carries strings; this only copies the arrays. */
export function toBillingPageResponse(page: BillingPageView): BillingPageResponseDto {
  return {
    projectId: page.projectId,
    plan: page.plan && {
      ...page.plan,
      installments: page.plan.installments.map((item) => ({ ...item })),
    },
    installments: page.installments.map((item) => ({ ...item })),
    recurringCharges: page.recurringCharges.map((item) => ({ ...item })),
  };
}
