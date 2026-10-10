import { z } from "./zod";
import {
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  VALIDATION_MESSAGES,
} from "./common";
import { invoiceStatusSchema, installmentKindSchema } from "./enums";
import { fileDtoSchema } from "./files";
import { currencyCodeSchema, moneyAmountSchema, percentSchema, rateSchema } from "./money";
import {
  addUsdRateIssue,
  facetSchema,
  optionalText,
  requiredText,
  timestampSchema,
} from "./catalogs";
import { agingBucketsSchema, multiSeriesSchema, signedDecimalSchema } from "./dashboard";
import { DEFAULT_IVA_RATES, isAllowedIvaRate, sameRate } from "./settings";
import { isDecimalString, mulMoney, compareMoney, toDecimal } from "../money";

/**
 * Invoice contracts (PRD §8.5, §9.3, §9.4, DT-44). An invoice is **registered** (the fiscal document is
 * issued elsewhere) and split into **lines**, each with its own VAT rate (`ivaRate`, one of the allowed
 * list in settings, or `null` = exempt) and an optional line discount. There is **no header VAT rate**:
 * subtotal, discount, exempt amount, tax base and IVA are derived (formula in `conventions.md` C17,
 * implemented in `lib/finance`). The only manual IVA input is a ±0.01 adjustment per rate to match the
 * physical document.
 *
 * The allowed VAT rates are a setting, so the input schemas come from factories
 * (`createInvoiceInputSchemaFor(allowedRates)`); the exported constants use the default list.
 */

export const INVOICE_MESSAGES = {
  discountExceedsAmount: "invoices.validation.discountExceedsAmount",
  ivaRateNotAllowed: "invoices.validation.ivaRateNotAllowed",
  adjustmentOutOfRange: "invoices.validation.adjustmentOutOfRange",
  adjustmentRateNotInLines: "invoices.validation.adjustmentRateNotInLines",
  duplicateAdjustmentRate: "invoices.validation.duplicateAdjustmentRate",
  dueBeforeIssue: "invoices.validation.dueBeforeIssue",
  otherWithheldNoteRequired: "invoices.validation.otherWithheldNoteRequired",
  duplicateInstallment: "invoices.validation.duplicateInstallment",
} as const;

/** Maximum manual IVA adjustment per rate, in invoice currency (PRD §9.3, CHECK `invtax_adjust`). */
export const IVA_ADJUSTMENT_LIMIT = "0.01";

const amountPositive = moneyAmountSchema({ sign: "positive" });
const amountNonNegative = moneyAmountSchema({ sign: "nonNegative" });
const amountAny = moneyAmountSchema({ sign: "any" });
const optionalId = idSchema.nullish().transform((value) => value ?? undefined);

/** Line quantity: `Decimal(12, 2)`, strictly positive. */
export const quantitySchema = amountPositive.refine(
  (value) => !isDecimalString(value) || /^\d{1,10}(?:\.\d+)?$/.test(value),
  { message: VALIDATION_MESSAGES.moneyOutOfRange },
);

function isPositive(value: string): boolean {
  return isDecimalString(value) && toDecimal(value).greaterThan(0);
}

// ───────────────────────────── Lines ─────────────────────────────

/** `round(quantity × unitPrice, 2)`, or `null` while an operand is not a valid decimal string. */
function lineAmount(quantity: string, unitPrice: string): string | null {
  if (!isDecimalString(quantity) || !isDecimalString(unitPrice)) return null;
  return mulMoney(quantity, unitPrice);
}

export const invoiceLineInputSchema = z
  .object({
    /** Present when editing an existing line. */
    id: idSchema.optional(),
    description: requiredText(300),
    projectId: optionalId,
    installmentId: optionalId,
    quantity: quantitySchema.default("1"),
    unitPrice: amountPositive,
    /** Line discount: `0 ≤ discount ≤ amount`. */
    discount: amountNonNegative.default("0"),
    /** One of the allowed rates (checked by the invoice schema) or `null` = exempt. */
    ivaRate: percentSchema.nullable(),
  })
  .superRefine((line, ctx) => {
    const amount = lineAmount(line.quantity, line.unitPrice);
    if (amount === null || !isDecimalString(line.discount)) return;
    if (compareMoney(line.discount, amount) > 0) {
      ctx.addIssue({
        code: "custom",
        message: INVOICE_MESSAGES.discountExceedsAmount,
        path: ["discount"],
      });
    }
  });
export type InvoiceLineInput = z.infer<typeof invoiceLineInputSchema>;

// ───────────────────────────── Invoice input ─────────────────────────────

/** ±0.01 adjustment of one rate's IVA, relative to `round(taxBase × rate / 100, 2)`. */
export const ivaAdjustmentSchema = z.object({
  ivaRate: percentSchema,
  adjustment: amountAny.refine(
    (value) =>
      !isDecimalString(value) || toDecimal(value).abs().lessThanOrEqualTo(IVA_ADJUSTMENT_LIMIT),
    { message: INVOICE_MESSAGES.adjustmentOutOfRange },
  ),
});
export type IvaAdjustmentInput = z.infer<typeof ivaAdjustmentSchema>;

const invoiceFields = {
  clientId: idSchema,
  /** Fiscal number as printed; unique among non-archived invoices (service rule, CONFLICT). */
  invoiceNumber: requiredText(40),
  controlNumber: optionalText(40),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: currencyCodeSchema,
  /** Units of `currency` per 1 USD on the issue date; `1` for USD. */
  usdRate: rateSchema,
  /** Reference BCV rate for foreign-currency invoices that must state the Bs. equivalent. */
  bcvRate: rateSchema.nullish().transform((value) => value ?? undefined),
  lines: z.array(invoiceLineInputSchema).min(1, VALIDATION_MESSAGES.required).max(200),
  /** At most one adjustment per rate used by the lines. */
  taxAdjustments: z.array(ivaAdjustmentSchema).max(10).default([]),
  ivaWithheld: amountNonNegative.default("0"),
  islrWithheld: amountNonNegative.default("0"),
  otherWithheld: amountNonNegative.default("0"),
  /** Description of the other withholdings; required when `otherWithheld` > 0. */
  otherWithheldNote: optionalText(200),
  fileId: optionalId,
  /** Drafts are saved but excluded from billing totals until issued (`issueDraft`). */
  isDraft: z.boolean().default(false),
};

type InvoiceChecked = {
  issueDate: string;
  dueDate: string;
  currency: string;
  usdRate: string;
  lines: { ivaRate: string | null }[];
  taxAdjustments: { ivaRate: string }[];
  otherWithheld: string;
  otherWithheldNote?: string | undefined;
};

function checkInvoice(
  input: InvoiceChecked,
  allowedIvaRates: readonly string[],
  ctx: z.RefinementCtx,
): void {
  if (input.dueDate < input.issueDate) {
    ctx.addIssue({ code: "custom", message: INVOICE_MESSAGES.dueBeforeIssue, path: ["dueDate"] });
  }
  addUsdRateIssue(ctx, input.currency, input.usdRate);

  input.lines.forEach((line, index) => {
    if (line.ivaRate !== null && !isAllowedIvaRate(line.ivaRate, allowedIvaRates)) {
      ctx.addIssue({
        code: "custom",
        message: INVOICE_MESSAGES.ivaRateNotAllowed,
        path: ["lines", index, "ivaRate"],
      });
    }
  });

  input.taxAdjustments.forEach((adjustment, index) => {
    const usedByLines = input.lines.some(
      (line) => line.ivaRate !== null && sameRate(line.ivaRate, adjustment.ivaRate),
    );
    if (!usedByLines) {
      ctx.addIssue({
        code: "custom",
        message: INVOICE_MESSAGES.adjustmentRateNotInLines,
        path: ["taxAdjustments", index, "ivaRate"],
      });
    }
    const firstIndex = input.taxAdjustments.findIndex((other) =>
      sameRate(other.ivaRate, adjustment.ivaRate),
    );
    if (firstIndex !== index) {
      ctx.addIssue({
        code: "custom",
        message: INVOICE_MESSAGES.duplicateAdjustmentRate,
        path: ["taxAdjustments", index, "ivaRate"],
      });
    }
  });

  if (isPositive(input.otherWithheld) && !input.otherWithheldNote) {
    ctx.addIssue({
      code: "custom",
      message: INVOICE_MESSAGES.otherWithheldNoteRequired,
      path: ["otherWithheldNote"],
    });
  }
}

/** `createInvoice` input for the given allowed VAT rates (settings `fiscal.ivaRates`). */
export function createInvoiceInputSchemaFor(
  allowedIvaRates: readonly string[] = DEFAULT_IVA_RATES,
) {
  return z
    .object(invoiceFields)
    .superRefine((input, ctx) => checkInvoice(input, allowedIvaRates, ctx));
}

/** `updateInvoice` input: the whole invoice again (lines are replaced) plus its id. */
export function updateInvoiceInputSchemaFor(
  allowedIvaRates: readonly string[] = DEFAULT_IVA_RATES,
) {
  return z
    .object({ id: idSchema, ...invoiceFields })
    .superRefine((input, ctx) => checkInvoice(input, allowedIvaRates, ctx));
}

export const createInvoiceInputSchema = createInvoiceInputSchemaFor();
export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;
export const updateInvoiceInputSchema = updateInvoiceInputSchemaFor();
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceInputSchema>;

export const issueDraftInputSchema = z.object({ id: idSchema });
export type IssueDraftInput = z.infer<typeof issueDraftInputSchema>;

/**
 * `voidInvoice`: the reason is mandatory. An invoice with allocations cannot be voided until they are
 * removed (INTEGRITY_LOCK, service rule); its payments stay as credit balance.
 */
export const voidInvoiceInputSchema = z.object({
  id: idSchema,
  reason: requiredText(500),
});
export type VoidInvoiceInput = z.infer<typeof voidInvoiceInputSchema>;

export const archiveInvoiceInputSchema = z.object({ id: idSchema });
export type ArchiveInvoiceInput = z.infer<typeof archiveInvoiceInputSchema>;

export const recomputeInvoiceInputSchema = z.object({ id: idSchema });
export type RecomputeInvoiceInput = z.infer<typeof recomputeInvoiceInputSchema>;

export const listOpenInvoicesInputSchema = z.object({ clientId: idSchema });
export type ListOpenInvoicesInput = z.infer<typeof listOpenInvoicesInputSchema>;

// ───────────────────────────── "Invoice installments" wizard (PRD §8.5) ─────────────────────────────

/**
 * Selected pending installments of any project of the client. The result is a prefilled draft (one
 * line per installment, project and installment already linked) that the user edits as a normal
 * invoice. `amount` bills part of an installment (partial billing); `ivaRate` defaults to the fiscal
 * default when omitted, and `null` means exempt.
 */
export const invoiceInstallmentsWizardInputSchema = z
  .object({
    clientId: idSchema,
    items: z
      .array(
        z.object({
          installmentId: idSchema,
          amount: amountPositive.optional(),
          ivaRate: percentSchema.nullable().optional(),
        }),
      )
      .min(1, VALIDATION_MESSAGES.required)
      .max(50),
  })
  .superRefine((input, ctx) => {
    input.items.forEach((item, index) => {
      if (input.items.findIndex((other) => other.installmentId === item.installmentId) !== index) {
        ctx.addIssue({
          code: "custom",
          message: INVOICE_MESSAGES.duplicateInstallment,
          path: ["items", index, "installmentId"],
        });
      }
    });
  });
export type InvoiceInstallmentsWizardInput = z.infer<typeof invoiceInstallmentsWizardInputSchema>;

export const invoiceInstallmentsDraftSchema = z.object({
  clientId: idSchema,
  /** Currency of the installments (an invoice has a single currency). */
  currency: currencyCodeSchema,
  lines: z.array(invoiceLineInputSchema).min(1),
});
export type InvoiceInstallmentsDraft = z.infer<typeof invoiceInstallmentsDraftSchema>;

/** A pending installment the wizard offers (PRD §8.5: `PENDIENTE` ones of the client's projects). */
export const billableInstallmentRowSchema = z.object({
  installment: entityRefSchema,
  project: entityRefSchema,
  kind: installmentKindSchema,
  label: z.string(),
  currency: currencyCodeSchema,
  amount: amountAny,
  /** Part of `amount` not yet covered by invoice lines. */
  remainingAmount: amountNonNegative,
  dueDate: dateOnlySchema.nullable(),
});
export type BillableInstallmentRow = z.infer<typeof billableInstallmentRowSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

export const invoiceLineDtoSchema = z.object({
  id: idSchema,
  order: z.number().int(),
  description: z.string(),
  project: entityRefSchema.nullable(),
  installment: entityRefSchema.nullable(),
  quantity: amountPositive,
  unitPrice: amountPositive,
  /** `round(quantity × unitPrice, 2)`. */
  amount: amountNonNegative,
  discount: amountNonNegative,
  /** `amount − discount`. */
  netAmount: amountNonNegative,
  /** `null` = exempt; `"0"` = taxable at 0 % (e.g. service export). */
  ivaRate: percentSchema.nullable(),
});
export type InvoiceLineDTO = z.infer<typeof invoiceLineDtoSchema>;

/** IVA of one rate: base, amount and the manual adjustment that produced it. */
export const invoiceTaxLineDtoSchema = z.object({
  ivaRate: percentSchema,
  taxBase: amountNonNegative,
  /** Final IVA of the rate: `round(taxBase × ivaRate / 100, 2) + adjustment`. */
  ivaAmount: amountNonNegative,
  /** Manual adjustment within ±0.01 (`"0.00"` when none). */
  adjustment: amountAny,
});
export type InvoiceTaxLineDTO = z.infer<typeof invoiceTaxLineDtoSchema>;

/** Header totals (all derived from the lines and tax lines, C17) plus USD snapshots (C16). */
export const invoiceTotalsDtoSchema = z.object({
  subtotal: amountNonNegative,
  discount: amountNonNegative,
  exemptAmount: amountNonNegative,
  taxBase: amountNonNegative,
  ivaAmount: amountNonNegative,
  total: amountNonNegative,
  ivaWithheld: amountNonNegative,
  islrWithheld: amountNonNegative,
  otherWithheld: amountNonNegative,
  otherWithheldNote: z.string().nullable(),
  /** `total − withholdings`. */
  receivable: amountNonNegative,
  totalUsd: amountNonNegative,
  receivableUsd: amountNonNegative,
  paidAmount: amountNonNegative,
  /** `receivable − paidAmount`. */
  balance: amountAny,
  /** Balance in USD at the invoice's own rate. */
  balanceUsd: amountAny,
});
export type InvoiceTotalsDTO = z.infer<typeof invoiceTotalsDtoSchema>;

/** Allocation as seen from the invoice ("Pagos" tab). */
export const invoiceAllocationRowSchema = z.object({
  id: idSchema,
  payment: entityRefSchema,
  paymentDate: dateOnlySchema,
  paymentCurrency: currencyCodeSchema,
  amountPaymentCurrency: amountPositive,
  amountInvoiceCurrency: amountPositive,
  amountUsd: amountNonNegative,
});
export type InvoiceAllocationRow = z.infer<typeof invoiceAllocationRowSchema>;

/** Table row (PRD §8.5 columns). */
export const invoiceListRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  invoiceNumber: z.string(),
  client: entityRefSchema,
  projects: z.array(entityRefSchema),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: currencyCodeSchema,
  total: amountNonNegative,
  balance: amountAny,
  totalUsd: amountNonNegative,
  balanceUsd: amountAny,
  status: invoiceStatusSchema,
  /** Days past the due date; `0` when not overdue. */
  daysOverdue: z.number().int().nonnegative(),
  /** Secondary "Partial payment" indicator on an overdue invoice with payments. */
  hasPartialPayment: z.boolean(),
});
export type InvoiceListRow = z.infer<typeof invoiceListRowSchema>;

export const invoiceDetailDtoSchema = z.object({
  id: idSchema,
  code: z.string(),
  client: entityRefSchema,
  invoiceNumber: z.string(),
  controlNumber: z.string().nullable(),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: currencyCodeSchema,
  usdRate: rateSchema,
  bcvRate: rateSchema.nullable(),
  isDraft: z.boolean(),
  status: invoiceStatusSchema,
  voidedAt: timestampSchema.nullable(),
  voidReason: z.string().nullable(),
  fileId: idSchema.nullable(),
  file: fileDtoSchema.nullable(),
  lines: z.array(invoiceLineDtoSchema),
  taxLines: z.array(invoiceTaxLineDtoSchema),
  totals: invoiceTotalsDtoSchema,
  allocations: z.array(invoiceAllocationRowSchema),
  daysOverdue: z.number().int().nonnegative(),
  hasPartialPayment: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export type InvoiceDetailDTO = z.infer<typeof invoiceDetailDtoSchema>;

/** Open invoice of a client, as the payment form's "Apply to invoices" list needs it. */
export const openInvoiceRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  invoiceNumber: z.string(),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: currencyCodeSchema,
  usdRate: rateSchema,
  receivable: amountNonNegative,
  balance: amountNonNegative,
  status: invoiceStatusSchema,
});
export type OpenInvoiceRow = z.infer<typeof openInvoiceRowSchema>;

// ───────────────────────────── List filters and overview ─────────────────────────────

export const invoiceFiltersSchema = listQuerySchema.extend({
  status: facetSchema(invoiceStatusSchema),
  clientId: idSchema.optional(),
  projectId: idSchema.optional(),
  currency: facetSchema(currencyCodeSchema),
  tagId: idSchema.optional(),
  /** Issue date range. */
  dateFrom: dateOnlySchema.optional(),
  dateTo: dateOnlySchema.optional(),
});
export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>;

export const invoicesOverviewDtoSchema = z.object({
  /** Last 6 months, series ids `billed` and `collected` (USD). */
  billedVsCollected: multiSeriesSchema,
  /** Open receivables in USD by days past due. */
  aging: agingBucketsSchema,
  overdueCount: z.number().int().nonnegative(),
  /** Open totals per invoice currency. */
  totalsByCurrency: z.array(
    z.object({
      currency: currencyCodeSchema,
      total: amountNonNegative,
      balance: signedDecimalSchema,
      overdue: amountNonNegative,
    }),
  ),
});
export type InvoicesOverviewDTO = z.infer<typeof invoicesOverviewDtoSchema>;
