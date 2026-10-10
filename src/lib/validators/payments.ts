import { z } from "./zod";
import {
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  withSortFields,
} from "./common";
import { paymentStatusSchema } from "./enums";
import { fileDtoSchema } from "./files";
import { currencyCodeSchema, moneyAmountSchema, rateSchema } from "./money";
import {
  addUsdRateIssue,
  facetSchema,
  optionalText,
  requiredText,
  timestampSchema,
} from "./catalogs";
import { breakdownItemSchema, nonNegativeDecimalSchema, seriesPointSchema } from "./dashboard";
import { compareMoney, isDecimalString, subMoney, sumMoney } from "../money";

/**
 * Payment contracts (PRD §8.6, §9.5, §9.6): a payment received from a client, its IGTF and fee, and its
 * allocation to invoices (N:M, possibly across currencies). Derived figures
 * (`allocatable = amount − igtf`, `netCredited = amount − fee`, `unallocated`) are computed in
 * `lib/finance` (C17) and only appear in DTOs.
 */

export const PAYMENT_MESSAGES = {
  referenceRequired: "payments.validation.referenceRequired",
  igtfExceedsAmount: "payments.validation.igtfExceedsAmount",
  feeExceedsAmount: "payments.validation.feeExceedsAmount",
  allocationsExceedAllocatable: "payments.validation.allocationsExceedAllocatable",
  duplicateInvoiceAllocation: "payments.validation.duplicateInvoiceAllocation",
} as const;

/** Non-blocking duplicate notice returned as an `ActionWarning` with `entity` = the existing payment. */
export const DUPLICATE_PAYMENT_WARNING = {
  code: "DUPLICATE_PAYMENT",
  message: "payments.warnings.duplicate",
} as const;

const amountPositive = moneyAmountSchema({ sign: "positive" });
const amountNonNegative = moneyAmountSchema({ sign: "nonNegative" });
const optionalId = idSchema.nullish().transform((value) => value ?? undefined);

/** A payment is created pending verification or confirmed; voiding goes through `setPaymentStatus`. */
export const PAYMENT_CREATE_STATUS_VALUES = ["PENDIENTE_VERIFICACION", "CONFIRMADO"] as const;
export const paymentCreateStatusSchema = z.enum(PAYMENT_CREATE_STATUS_VALUES);

// ───────────────────────────── Allocations ─────────────────────────────

/** Amount applied to one invoice, in the payment currency and in the invoice currency (PRD §9.5). */
export const allocationInputSchema = z.object({
  invoiceId: idSchema,
  amountPaymentCurrency: amountPositive,
  /** Proposed from the payment-date rates, editable; equals the payment amount when currencies match. */
  amountInvoiceCurrency: amountPositive,
});
export type AllocationInput = z.infer<typeof allocationInputSchema>;

/** `allocatePayment`: applies (part of) an existing payment to an invoice. */
export const allocatePaymentInputSchema = allocationInputSchema.extend({ paymentId: idSchema });
export type AllocatePaymentInput = z.infer<typeof allocatePaymentInputSchema>;

export const deallocatePaymentInputSchema = z.object({ allocationId: idSchema });
export type DeallocatePaymentInput = z.infer<typeof deallocatePaymentInputSchema>;

// ───────────────────────────── Payment input ─────────────────────────────

export interface PaymentSchemaOptions {
  /**
   * `PaymentMethod.requiresReference` of the selected method. The method is data, so the form (and
   * the service, which looks the method up) pass it in; a payment without reference is then rejected.
   */
  requiresReference?: boolean;
}

const paymentFields = {
  clientId: idSchema,
  date: dateOnlySchema,
  accountId: idSchema,
  methodId: idSchema,
  currency: currencyCodeSchema,
  /** Amount received from the client. */
  amount: amountPositive,
  /** Part of `amount` that is IGTF (proposed from settings, editable); not income. */
  igtfAmount: amountNonNegative.default("0"),
  /** What the processor withholds; reduces the amount credited to the account. */
  feeAmount: amountNonNegative.default("0"),
  usdRate: rateSchema,
  reference: optionalText(80),
  receiptFileId: optionalId,
  status: paymentCreateStatusSchema.default("CONFIRMADO"),
};

type PaymentChecked = {
  currency: string;
  amount: string;
  igtfAmount: string;
  feeAmount: string;
  usdRate: string;
  reference?: string | undefined;
  allocations?: { invoiceId: string; amountPaymentCurrency: string }[] | undefined;
};

function checkPayment(input: PaymentChecked, options: PaymentSchemaOptions, ctx: z.RefinementCtx) {
  if (options.requiresReference && !input.reference) {
    ctx.addIssue({
      code: "custom",
      message: PAYMENT_MESSAGES.referenceRequired,
      path: ["reference"],
    });
  }
  addUsdRateIssue(ctx, input.currency, input.usdRate);
  if (!isDecimalString(input.amount)) return;

  if (isDecimalString(input.igtfAmount) && compareMoney(input.igtfAmount, input.amount) > 0) {
    ctx.addIssue({
      code: "custom",
      message: PAYMENT_MESSAGES.igtfExceedsAmount,
      path: ["igtfAmount"],
    });
  }
  if (isDecimalString(input.feeAmount) && compareMoney(input.feeAmount, input.amount) > 0) {
    ctx.addIssue({
      code: "custom",
      message: PAYMENT_MESSAGES.feeExceedsAmount,
      path: ["feeAmount"],
    });
  }

  const allocations = input.allocations ?? [];
  allocations.forEach((allocation, index) => {
    if (allocations.findIndex((other) => other.invoiceId === allocation.invoiceId) !== index) {
      ctx.addIssue({
        code: "custom",
        message: PAYMENT_MESSAGES.duplicateInvoiceAllocation,
        path: ["allocations", index, "invoiceId"],
      });
    }
  });
  const amounts = allocations.map((allocation) => allocation.amountPaymentCurrency);
  if (
    amounts.length > 0 &&
    amounts.every(isDecimalString) &&
    isDecimalString(input.igtfAmount) &&
    compareMoney(sumMoney(amounts), subMoney(input.amount, input.igtfAmount)) > 0
  ) {
    ctx.addIssue({
      code: "custom",
      message: PAYMENT_MESSAGES.allocationsExceedAllocatable,
      path: ["allocations"],
    });
  }
}

/**
 * `createPayment` input. Rules: reference required when the method requires it, IGTF and fee not above
 * the amount, allocations (optional, to apply at creation) one per invoice and not above
 * `amount − igtf`, USD rate 1 for USD.
 */
export function createPaymentInputSchemaFor(options: PaymentSchemaOptions = {}) {
  return z
    .object({ ...paymentFields, allocations: z.array(allocationInputSchema).max(50).default([]) })
    .superRefine((input, ctx) => checkPayment(input, options, ctx));
}

/** `updatePayment` input: the payment fields again plus its id; allocations change only through (de)allocate. */
export function updatePaymentInputSchemaFor(options: PaymentSchemaOptions = {}) {
  return z
    .object({ id: idSchema, ...paymentFields })
    .superRefine((input, ctx) => checkPayment(input, options, ctx));
}

export const createPaymentInputSchema = createPaymentInputSchemaFor();
export type CreatePaymentInput = z.infer<typeof createPaymentInputSchema>;
export const updatePaymentInputSchema = updatePaymentInputSchemaFor();
export type UpdatePaymentInput = z.infer<typeof updatePaymentInputSchema>;

/** Voiding a payment removes its allocations logically and recomputes the invoices (service rule). */
export const setPaymentStatusInputSchema = z.object({
  id: idSchema,
  status: paymentStatusSchema,
  reason: optionalText(500),
});
export type SetPaymentStatusInput = z.infer<typeof setPaymentStatusInputSchema>;

// ───────────────────────────── Duplicate detection (PRD §8.6) ─────────────────────────────

/** Same reference + method + account is a possible duplicate. */
export const detectDuplicatePaymentInputSchema = z.object({
  methodId: idSchema,
  accountId: idSchema,
  reference: requiredText(80),
  /** The payment being edited, so it does not match itself. */
  excludePaymentId: optionalId,
});
export type DetectDuplicatePaymentInput = z.infer<typeof detectDuplicatePaymentInputSchema>;

export const duplicatePaymentMatchSchema = z.object({
  payment: entityRefSchema,
  date: dateOnlySchema,
  amount: amountPositive,
  currency: currencyCodeSchema,
  status: paymentStatusSchema,
});
export type DuplicatePaymentMatch = z.infer<typeof duplicatePaymentMatchSchema>;

/** Duplicate-warning DTO: empty `matches` means no duplicate. The UI links to each match. */
export const duplicatePaymentWarningDtoSchema = z.object({
  duplicate: z.boolean(),
  matches: z.array(duplicatePaymentMatchSchema),
});
export type DuplicatePaymentWarningDTO = z.infer<typeof duplicatePaymentWarningDtoSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Method as shown in tables (catalog row, not an entity type). */
export const paymentMethodRefSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
});
export type PaymentMethodRef = z.infer<typeof paymentMethodRefSchema>;

/** Allocation as seen from the payment ("Asignaciones" tab). */
export const paymentAllocationDtoSchema = z.object({
  id: idSchema,
  paymentId: idSchema,
  invoice: entityRefSchema,
  invoiceCurrency: currencyCodeSchema,
  amountPaymentCurrency: amountPositive,
  amountInvoiceCurrency: amountPositive,
  amountUsd: amountNonNegative,
  createdAt: timestampSchema,
});
export type PaymentAllocationDTO = z.infer<typeof paymentAllocationDtoSchema>;

/** Table row (PRD §8.6 columns). */
export const paymentListRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  date: dateOnlySchema,
  client: entityRefSchema,
  method: paymentMethodRefSchema,
  account: entityRefSchema,
  currency: currencyCodeSchema,
  amount: amountPositive,
  amountUsd: amountNonNegative,
  /** Σ allocations in the payment currency. */
  allocated: amountNonNegative,
  unallocated: amountNonNegative,
  reference: z.string().nullable(),
  status: paymentStatusSchema,
});
export type PaymentListRow = z.infer<typeof paymentListRowSchema>;

export const paymentDetailDtoSchema = paymentListRowSchema.extend({
  igtfAmount: amountNonNegative,
  feeAmount: amountNonNegative,
  /** `amount − fee`: what enters the account. */
  netCredited: amountNonNegative,
  /** `amount − igtf`: what can be applied to invoices. */
  allocatable: amountNonNegative,
  usdRate: rateSchema,
  receiptFileId: idSchema.nullable(),
  receipt: fileDtoSchema.nullable(),
  allocations: z.array(paymentAllocationDtoSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export type PaymentDetailDTO = z.infer<typeof paymentDetailDtoSchema>;

export const PAYMENT_SORT_FIELDS = [
  "code",
  "date",
  "amount",
  "amountUsd",
  "allocated",
  "unallocated",
  "reference",
  "status",
] as const;

export const paymentFiltersSchema = withSortFields(
  listQuerySchema.extend({
    status: facetSchema(paymentStatusSchema),
    clientId: idSchema.optional(),
    accountId: idSchema.optional(),
    methodId: idSchema.optional(),
    currency: facetSchema(currencyCodeSchema),
    dateFrom: dateOnlySchema.optional(),
    dateTo: dateOnlySchema.optional(),
    /** Only payments with a credit balance left to apply. */
    hasUnallocated: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
  PAYMENT_SORT_FIELDS,
);
export type PaymentFilters = z.infer<typeof paymentFiltersSchema>;

export const paymentsOverviewDtoSchema = z.object({
  /** Collected per month, last 12 months (USD). */
  collectedByMonth: z.array(seriesPointSchema),
  byMethod: z.array(breakdownItemSchema),
  byAccount: z.array(breakdownItemSchema),
  pendingVerificationCount: z.number().int().nonnegative(),
  unallocatedCount: z.number().int().nonnegative(),
  unallocatedTotalUsd: nonNegativeDecimalSchema,
});
export type PaymentsOverviewDTO = z.infer<typeof paymentsOverviewDtoSchema>;
