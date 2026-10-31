import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import { INSTALLMENT_KIND_VALUES, INVOICE_STATUS_VALUES } from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  decimalStringSchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import type { OpenInvoiceView } from '../../../application/ports/invoice.repository.port';
import {
  DEFAULT_INVOICE_SORT,
  type ListInvoices,
} from '../../../application/use-cases/invoices/list-invoices.use-case';
import type { BillableInstallmentOutput } from '../../../application/use-cases/invoices/invoice-wizard-reads.use-case';
import {
  INVOICE_SORT_FIELDS,
  type InvoiceListRowOutput,
  type InvoiceOutput,
} from '../../../application/use-cases/invoices/invoice-support';

/**
 * Request and response shapes of the invoice routes (PRD §8.5; the FE `invoices` validators). Money and rates
 * are decimal strings (C15). The request shapes only fix the types: every business and shape rule (amounts,
 * allowed VAT rates, ±0.01 adjustments, discount limits, dates) lives in the use cases and answers `VALIDATION`
 * with the same keys, so a caller that skips the DTO meets the same rules (lesson B2).
 */

const invoiceStatus = z.enum(INVOICE_STATUS_VALUES);
const installmentKind = z.enum(INSTALLMENT_KIND_VALUES);
const optionalId = idSchema.nullish();
const text = z.string();
const money = z.string();

export const invoiceIdParamsSchema = z.object({ id: idSchema });
export class InvoiceIdParamsDto extends createZodDto(invoiceIdParamsSchema) {}

export const clientIdParamsSchema = z.object({ id: idSchema });
export class ClientIdParamsDto extends createZodDto(clientIdParamsSchema) {}

/** `GET /invoices`: paging, search, sort, `archived` (trash roles only) and the facets of the table. */
export class ListInvoicesQueryDto extends createListQueryDto({
  sortFields: INVOICE_SORT_FIELDS,
  defaultSort: DEFAULT_INVOICE_SORT,
  filters: {
    status: invoiceStatus,
    clientId: idSchema,
    projectId: idSchema,
    currency: z.string().regex(/^[A-Z][A-Z0-9]{2,9}$/, { message: 'validation.currency.invalid' }),
    tagId: idSchema,
    dateFrom: dateOnlySchema,
    dateTo: dateOnlySchema,
  },
}) {}

const lineInput = z.object({
  /** Present when editing an existing line of the invoice; any other id is replaced. */
  id: idSchema.optional(),
  description: text,
  projectId: optionalId,
  installmentId: optionalId,
  quantity: money.optional(),
  unitPrice: money,
  discount: money.optional(),
  /** `null` is exempt; `"0"` is taxable at 0 %. */
  ivaRate: money.nullable(),
});

const adjustmentInput = z.object({
  ivaRate: money,
  /** Within ±0.01 of `round(taxBase × ivaRate / 100, 2)`. */
  adjustment: money,
});

const invoiceFields = {
  clientId: idSchema,
  /** Fiscal number as printed; unique among non-archived invoices (`CONFLICT` otherwise). */
  invoiceNumber: text,
  controlNumber: text.nullish(),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: text,
  /** Units of `currency` per 1 USD on the issue date; `1` for USD. */
  usdRate: money,
  bcvRate: money.nullish(),
  lines: z.array(lineInput),
  /** At most one adjustment per rate used by the lines. */
  taxAdjustments: z.array(adjustmentInput).optional(),
  ivaWithheld: money.optional(),
  islrWithheld: money.optional(),
  otherWithheld: money.optional(),
  /** Required when `otherWithheld` is above zero. */
  otherWithheldNote: text.nullish(),
  /** Claims a `READY` file (PDF or image, up to 10 MB). On `PATCH`, absent keeps it and `null` detaches it. */
  fileId: optionalId,
  /** Drafts are saved but count in no total until issued. */
  isDraft: z.boolean().optional(),
};

/** `POST /invoices`: the whole invoice. */
export class CreateInvoiceDto extends createZodDto(z.object(invoiceFields)) {}
/** `PATCH /invoices/{id}`: the whole invoice again (lines are replaced). */
export class UpdateInvoiceDto extends createZodDto(z.object(invoiceFields)) {}
/** `POST /invoices/{id}/void`: the reason is mandatory. */
export class VoidInvoiceDto extends createZodDto(z.object({ reason: text })) {}
/** `PUT /invoices/{id}/file`. */
export class AttachInvoiceFileDto extends createZodDto(z.object({ fileId: idSchema.nullable() })) {}

// ───────────────────────────── Responses ─────────────────────────────

const refSchema = z.object(entityRefResponseSchema.shape);
const nullableRef = refSchema.nullable();

const lineResponse = z.object({
  id: idSchema,
  order: z.number().int(),
  description: z.string(),
  project: nullableRef,
  installment: nullableRef,
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  /** `round(quantity × unitPrice, 2)`. */
  amount: decimalStringSchema,
  discount: decimalStringSchema,
  /** `amount − discount`. */
  netAmount: decimalStringSchema,
  /** `null` = exempt; `"0"` = taxable at 0 %. */
  ivaRate: decimalStringSchema.nullable(),
});

const taxLineResponse = z.object({
  ivaRate: decimalStringSchema,
  taxBase: decimalStringSchema,
  /** Final IVA of the rate: `round(taxBase × ivaRate / 100, 2) + adjustment`. */
  ivaAmount: decimalStringSchema,
  /** Manual adjustment within ±0.01 (`"0.00"` when none). */
  adjustment: decimalStringSchema,
});

const totalsResponse = z.object({
  subtotal: decimalStringSchema,
  discount: decimalStringSchema,
  exemptAmount: decimalStringSchema,
  taxBase: decimalStringSchema,
  ivaAmount: decimalStringSchema,
  total: decimalStringSchema,
  ivaWithheld: decimalStringSchema,
  islrWithheld: decimalStringSchema,
  otherWithheld: decimalStringSchema,
  otherWithheldNote: z.string().nullable(),
  /** `total − withholdings`. */
  receivable: decimalStringSchema,
  totalUsd: decimalStringSchema,
  receivableUsd: decimalStringSchema,
  paidAmount: decimalStringSchema,
  /** `receivable − paidAmount`. */
  balance: decimalStringSchema,
  /** Balance in USD at the invoice's own rate. */
  balanceUsd: decimalStringSchema,
});

export const fileResponse = z.object({
  id: idSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.string(),
  uploadedById: idSchema,
  createdAt: timestampSchema,
});

const allocationResponse = z.object({
  id: idSchema,
  payment: refSchema,
  paymentDate: dateOnlySchema,
  paymentCurrency: z.string(),
  amountPaymentCurrency: decimalStringSchema,
  amountInvoiceCurrency: decimalStringSchema,
  amountUsd: decimalStringSchema,
});

export const invoiceResponseSchema = z.object({
  id: idSchema,
  code: z.string(),
  client: refSchema,
  invoiceNumber: z.string(),
  controlNumber: z.string().nullable(),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: z.string(),
  usdRate: decimalStringSchema,
  bcvRate: decimalStringSchema.nullable(),
  isDraft: z.boolean(),
  status: invoiceStatus,
  voidedAt: timestampSchema.nullable(),
  voidReason: z.string().nullable(),
  /** Set while the invoice sits in the trash. */
  archivedAt: timestampSchema.nullable(),
  fileId: idSchema.nullable(),
  file: fileResponse.nullable(),
  lines: z.array(lineResponse),
  taxLines: z.array(taxLineResponse),
  totals: totalsResponse,
  allocations: z.array(allocationResponse),
  daysOverdue: z.number().int().nonnegative(),
  hasPartialPayment: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  createdById: idSchema.nullable(),
});
export class InvoiceResponseDto extends createZodDto(invoiceResponseSchema) {}

const rowResponse = z.object({
  id: idSchema,
  code: z.string(),
  invoiceNumber: z.string(),
  client: refSchema,
  projects: z.array(refSchema),
  issueDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  currency: z.string(),
  total: decimalStringSchema,
  balance: decimalStringSchema,
  totalUsd: decimalStringSchema,
  balanceUsd: decimalStringSchema,
  status: invoiceStatus,
  daysOverdue: z.number().int().nonnegative(),
  hasPartialPayment: z.boolean(),
  archivedAt: timestampSchema.nullable(),
});
export class InvoiceListResponseDto extends createZodDto(
  z.object({
    items: z.array(rowResponse),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    pageCount: z.number().int(),
  }),
) {}

const billableResponse = z.object({
  installment: refSchema,
  project: refSchema,
  kind: installmentKind,
  label: z.string(),
  currency: z.string(),
  amount: decimalStringSchema,
  /** Part of `amount` not yet covered by live invoice lines. */
  remainingAmount: decimalStringSchema,
  dueDate: dateOnlySchema.nullable(),
});
export class BillableInstallmentResponseDto extends createZodDto(billableResponse) {}

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
export class OpenInvoiceResponseDto extends createZodDto(openInvoiceResponse) {}

export class RestoredInvoiceResponseDto extends createZodDto(
  z.object({ entity: refSchema, restoredAt: timestampSchema }),
) {}

// ───────────────────────────── Output mapping ─────────────────────────────

const refOf = (ref: EntityRef) => ({
  type: ref.type,
  id: ref.id,
  code: ref.code ?? null,
  label: ref.label,
});
const nullableRefOf = (ref: EntityRef | null) => (ref ? refOf(ref) : null);

export function toInvoiceResponse(output: InvoiceOutput): z.infer<typeof invoiceResponseSchema> {
  return {
    id: output.id,
    code: output.code,
    client: refOf(output.client),
    invoiceNumber: output.invoiceNumber,
    controlNumber: output.controlNumber,
    issueDate: output.issueDate,
    dueDate: output.dueDate,
    currency: output.currency,
    usdRate: output.usdRate,
    bcvRate: output.bcvRate,
    isDraft: output.isDraft,
    status: output.status,
    voidedAt: output.voidedAt,
    voidReason: output.voidReason,
    archivedAt: output.archivedAt,
    fileId: output.fileId,
    file: output.file,
    lines: output.lines.map((line) => ({
      id: line.id,
      order: line.order,
      description: line.description,
      project: nullableRefOf(line.project),
      installment: nullableRefOf(line.installment),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      discount: line.discount,
      netAmount: line.netAmount,
      ivaRate: line.ivaRate,
    })),
    taxLines: output.taxLines.map((line) => ({ ...line })),
    totals: {
      subtotal: output.subtotal,
      discount: output.discount,
      exemptAmount: output.exemptAmount,
      taxBase: output.taxBase,
      ivaAmount: output.ivaAmount,
      total: output.total,
      ivaWithheld: output.ivaWithheld,
      islrWithheld: output.islrWithheld,
      otherWithheld: output.otherWithheld,
      otherWithheldNote: output.otherWithheldNote,
      receivable: output.receivable,
      totalUsd: output.totalUsd,
      receivableUsd: output.receivableUsd,
      paidAmount: output.paidAmount,
      balance: output.balance,
      balanceUsd: output.balanceUsd,
    },
    allocations: output.allocations.map((allocation) => ({
      ...allocation,
      payment: refOf(allocation.payment),
    })),
    daysOverdue: output.daysOverdue,
    hasPartialPayment: output.hasPartialPayment,
    createdAt: output.createdAt,
    updatedAt: output.updatedAt,
    createdById: output.createdById,
  };
}

export function toInvoiceRowResponse(row: InvoiceListRowOutput): z.infer<typeof rowResponse> {
  return {
    id: row.id,
    code: row.code,
    invoiceNumber: row.invoiceNumber,
    client: refOf(row.client),
    projects: row.projects.map(refOf),
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    total: row.total,
    balance: row.balance,
    totalUsd: row.totalUsd,
    balanceUsd: row.balanceUsd,
    status: row.status,
    daysOverdue: row.daysOverdue,
    hasPartialPayment: row.hasPartialPayment,
    archivedAt: row.archivedAt,
  };
}

export function toBillableResponse(
  row: BillableInstallmentOutput,
): z.infer<typeof billableResponse> {
  return { ...row, installment: refOf(row.installment), project: refOf(row.project) };
}

export function toOpenInvoiceResponse(row: OpenInvoiceView): z.infer<typeof openInvoiceResponse> {
  return { ...row };
}

export type ListInvoicesResult = Awaited<ReturnType<ListInvoices['execute']>>;
