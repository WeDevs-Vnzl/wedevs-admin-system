import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { INVOICE_STATUS_VALUES, PAYMENT_STATUS_VALUES } from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  moneyAmountSchema,
  rateSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import type { OpenInvoiceView } from '../../../application/ports/invoice.repository.port';
import type {
  PaymentAllocationView,
  PaymentListRowView,
} from '../../../application/ports/payment.repository.port';
import { PAYMENT_SORT_FIELDS } from '../../../application/use-cases/payments/payment-input';
import type { PaymentOutput } from '../../../application/use-cases/payments/payment-support';
import { fileResponse } from './invoices.dto';
import {
  DEFAULT_PAYMENT_SORT,
  type ClientCreditOutput,
  type DuplicatePaymentWarning,
  type InvoicePaymentContext,
} from '../../../application/use-cases/payments/payment-reads.use-case';

/**
 * Request and response shapes of the payment routes (PRD §8.6; the FE `payments` validators). Money and rates are
 * decimal strings (C15). Every business rule (reference required by the method, IGTF and fee not above the amount,
 * USD rate 1 for USD, allocation limits) lives in the use cases and answers `VALIDATION` with the same keys, so a
 * caller that skips the DTO meets the same rules (lesson B2). The DTO fixes the types and the field formats.
 */

const amountPositive = moneyAmountSchema({ sign: 'positive' });
const amountNonNegative = moneyAmountSchema({ sign: 'nonNegative' });
const currencyCode = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{2,9}$/, { message: 'validation.currency.invalid' });
const optionalId = idSchema.nullish();
const paymentStatus = z.enum(PAYMENT_STATUS_VALUES);
const invoiceStatus = z.enum(INVOICE_STATUS_VALUES);

export const paymentIdParamsSchema = z.object({ id: idSchema });
export class PaymentIdParamsDto extends createZodDto(paymentIdParamsSchema) {}
export class AllocationIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
export class InvoiceIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
export class ClientIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}

/** `GET /payments`: paging, search, sort and the facets of the table. */
export class ListPaymentsQueryDto extends createListQueryDto({
  sortFields: PAYMENT_SORT_FIELDS,
  defaultSort: DEFAULT_PAYMENT_SORT,
  filters: {
    status: paymentStatus,
    clientId: idSchema,
    accountId: idSchema,
    methodId: idSchema,
    currency: currencyCode,
    tagId: idSchema,
    dateFrom: dateOnlySchema,
    dateTo: dateOnlySchema,
    /** Only payments with a credit balance left to apply. */
    hasUnallocated: z.enum(['true', 'false']),
  },
}) {}

/** Amount applied to one invoice, in the payment currency and in the invoice currency (PRD §9.5). */
const allocationFields = {
  invoiceId: idSchema,
  amountPaymentCurrency: amountPositive,
  /** Proposed from the payment-date rates, editable; equals the payment amount when currencies match. */
  amountInvoiceCurrency: amountPositive,
};

const paymentFields = {
  clientId: idSchema,
  date: dateOnlySchema,
  accountId: idSchema,
  methodId: idSchema,
  /** Equals the currency of the account. */
  currency: currencyCode,
  /** Amount received from the client. */
  amount: amountPositive,
  /** Part of `amount` that is IGTF (proposed from settings, editable); not income. */
  igtfAmount: amountNonNegative.default('0'),
  /** What the processor withholds; reduces the amount credited to the account. */
  feeAmount: amountNonNegative.default('0'),
  usdRate: rateSchema,
  /** Required when the method asks for one; at most 80 characters. */
  reference: z.string().nullish(),
  receiptFileId: optionalId,
};

/** `POST /payments`: pending verification or confirmed, with optional allocations to apply at creation. */
export class CreatePaymentDto extends createZodDto(
  z.object({
    ...paymentFields,
    status: z.enum(['PENDIENTE_VERIFICACION', 'CONFIRMADO']).default('CONFIRMADO'),
    allocations: z.array(z.object(allocationFields)).default([]),
  }),
) {}

/** `PATCH /payments/{id}`: the payment fields again. On `receiptFileId`, absent keeps and `null` detaches. */
export class UpdatePaymentDto extends createZodDto(z.object(paymentFields)) {}

/** `POST /payments/{id}/status`. */
export class SetPaymentStatusDto extends createZodDto(
  z.object({ status: paymentStatus, reason: z.string().nullish() }),
) {}

/** `POST /payments/{id}/allocations`. */
export class AllocatePaymentDto extends createZodDto(z.object(allocationFields)) {}

/** `GET /payments/duplicates`: the same reference, method and account is a possible duplicate. */
export class DuplicatePaymentQueryDto extends createZodDto(
  z.object({
    methodId: idSchema,
    accountId: idSchema,
    reference: z.string(),
    /** The payment being edited, so it does not match itself. */
    excludePaymentId: idSchema.optional(),
  }),
) {}

// ───────────────────────────── Responses ─────────────────────────────

const refSchema = z.object(entityRefResponseSchema.shape);

const methodResponse = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
});

const allocationResponse = z.object({
  id: idSchema,
  paymentId: idSchema,
  invoice: refSchema,
  invoiceCurrency: z.string(),
  amountPaymentCurrency: decimalStringSchema,
  amountInvoiceCurrency: decimalStringSchema,
  amountUsd: decimalStringSchema,
  createdAt: timestampSchema,
});
export class PaymentAllocationResponseDto extends createZodDto(allocationResponse) {}

const rowResponse = z.object({
  id: idSchema,
  code: z.string(),
  date: dateOnlySchema,
  client: refSchema,
  method: methodResponse,
  account: refSchema,
  currency: z.string(),
  amount: decimalStringSchema,
  amountUsd: decimalStringSchema,
  /** Σ live allocations in the payment currency. */
  allocated: decimalStringSchema,
  unallocated: decimalStringSchema,
  reference: z.string().nullable(),
  status: paymentStatus,
});

export const paymentResponseSchema = rowResponse.extend({
  igtfAmount: decimalStringSchema,
  feeAmount: decimalStringSchema,
  /** `amount − fee`: what enters the account. */
  netCredited: decimalStringSchema,
  /** `amount − igtf`: what can be applied to invoices. */
  allocatable: decimalStringSchema,
  usdRate: decimalStringSchema,
  receiptFileId: idSchema.nullable(),
  /** Metadata of the receipt file; the download goes through the files API (C23). */
  receipt: fileResponse.nullable(),
  allocations: z.array(allocationResponse),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export class PaymentResponseDto extends createZodDto(paymentResponseSchema) {}

export class PaymentListResponseDto extends createZodDto(
  z.object({
    items: z.array(rowResponse),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    pageCount: z.number().int(),
  }),
) {}

export class DuplicatePaymentResponseDto extends createZodDto(
  z.object({
    duplicate: z.boolean(),
    matches: z.array(
      z.object({
        payment: refSchema,
        date: dateOnlySchema,
        amount: decimalStringSchema,
        currency: z.string(),
        status: paymentStatus,
      }),
    ),
  }),
) {}

export class ClientCreditResponseDto extends createZodDto(
  z.object({
    totalUsd: decimalStringSchema,
    payments: z.array(
      z.object({
        paymentId: idSchema,
        code: z.string(),
        date: dateOnlySchema,
        currency: z.string(),
        unallocated: decimalStringSchema,
        unallocatedUsd: decimalStringSchema,
      }),
    ),
  }),
) {}

const openInvoiceResponse = z.object({
  id: idSchema,
  code: z.string(),
  invoiceNumber: z.string(),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: z.string(),
  usdRate: decimalStringSchema,
  receivable: decimalStringSchema,
  balance: decimalStringSchema,
  status: invoiceStatus,
});
export class InvoicePaymentContextResponseDto extends createZodDto(
  z.object({ client: refSchema, invoice: openInvoiceResponse }),
) {}

// ───────────────────────────── Output mapping ─────────────────────────────

const refOf = (ref: EntityRef) => ({
  type: ref.type,
  id: ref.id,
  code: ref.code ?? null,
  label: ref.label,
});

export function toAllocationResponse(
  view: PaymentAllocationView,
): z.infer<typeof allocationResponse> {
  return { ...view, invoice: refOf(view.invoice) };
}

export function toPaymentRowResponse(row: PaymentListRowView): z.infer<typeof rowResponse> {
  return {
    id: row.id,
    code: row.code,
    date: row.date,
    client: refOf(row.client),
    method: row.method,
    account: refOf(row.account),
    currency: row.currency,
    amount: row.amount,
    amountUsd: row.amountUsd,
    allocated: row.allocated,
    unallocated: row.unallocated,
    reference: row.reference,
    status: row.status,
  };
}

export function toPaymentResponse(output: PaymentOutput): z.infer<typeof paymentResponseSchema> {
  return {
    ...toPaymentRowResponse(output),
    igtfAmount: output.igtfAmount,
    feeAmount: output.feeAmount,
    netCredited: output.netCredited,
    allocatable: output.allocatable,
    usdRate: output.usdRate,
    receiptFileId: output.receiptFileId,
    receipt: output.receipt,
    allocations: output.allocations.map(toAllocationResponse),
    createdAt: output.createdAt,
    updatedAt: output.updatedAt,
    createdById: output.createdById,
  };
}

export function toDuplicateResponse(warning: DuplicatePaymentWarning) {
  return {
    duplicate: warning.duplicate,
    matches: warning.matches.map((match) => ({ ...match, payment: refOf(match.payment) })),
  };
}

export function toCreditResponse(credit: ClientCreditOutput) {
  return { totalUsd: credit.totalUsd, payments: credit.payments.map((row) => ({ ...row })) };
}

export function toPaymentContextResponse(context: InvoicePaymentContext) {
  const invoice: OpenInvoiceView = context.invoice;
  return { client: refOf(context.client), invoice: { ...invoice } };
}
