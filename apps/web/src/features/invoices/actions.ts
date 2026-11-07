"use server";

import { apiAction } from "@/lib/api/action";
import type {
  CreateInvoiceDto,
  InvoiceListResponseDto,
  InvoiceResponseDto,
  RestoredInvoiceResponseDto,
} from "@/lib/api/types/invoices";
import {
  entityRefSchema,
  errorMessageKey,
  idSchema,
  type ActionResult,
  type EntityRef,
} from "@/lib/validators/common";
import {
  billableInstallmentRowSchema,
  invoiceFiltersSchema,
  type ArchiveInvoiceInput,
  type BillableInstallmentRow,
  type CreateInvoiceInput,
  type IssueDraftInput,
  type ListOpenInvoicesInput,
  type UpdateInvoiceInput,
  type VoidInvoiceInput,
} from "@/lib/validators/invoices";
import { z } from "@/lib/validators/zod";
import { toInvoiceListQuery } from "./api-query";
import type { InvoiceFilterInput } from "./components/invoice-table-query";
import type { AttachInvoiceFileInput } from "./schemas";

// Thin API proxies (C10, PRD §8.5, HU-11, HU-12): token → one BE call → error mapping → revalidate. The BE decides
// every grant, every total and every refusal (number taken, archived, restore conflicts); the FE never checks
// `can()` or computes a figure here. Amounts travel as decimal strings (C15).

const LIST_PATHS = ["/invoices", "/invoices/list"];

/**
 * The form's parsed values → the BE body (C8). Optional fields the form leaves out travel as `null` so an edit
 * clears them; `fileId` is sent only when given, because an edit that omits it must not detach the PDF.
 */
function invoiceBody(input: CreateInvoiceInput): CreateInvoiceDto {
  return {
    clientId: input.clientId,
    invoiceNumber: input.invoiceNumber,
    controlNumber: input.controlNumber ?? null,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    usdRate: input.usdRate,
    bcvRate: input.bcvRate ?? null,
    isDraft: input.isDraft,
    lines: input.lines.map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      description: line.description,
      projectId: line.projectId ?? null,
      installmentId: line.installmentId ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRate: line.ivaRate,
    })),
    taxAdjustments: input.taxAdjustments.map(({ ivaRate, adjustment }) => ({
      ivaRate,
      adjustment,
    })),
    ivaWithheld: input.ivaWithheld,
    islrWithheld: input.islrWithheld,
    otherWithheld: input.otherWithheld,
    otherWithheldNote: input.otherWithheldNote ?? null,
    ...(input.fileId !== undefined ? { fileId: input.fileId } : {}),
  };
}

export const createInvoiceAction = apiAction<CreateInvoiceInput, InvoiceResponseDto>({
  call: (input, api) => api.POST("/api/v1/invoices", { body: invoiceBody(input) }),
  revalidate: [...LIST_PATHS, "/projects", "/"],
});

export const updateInvoiceAction = apiAction<UpdateInvoiceInput, InvoiceResponseDto>({
  call: ({ id, ...input }, api) =>
    api.PATCH("/api/v1/invoices/{id}", {
      params: { path: { id } },
      body: invoiceBody(input),
    }),
  revalidate: (input) => [...LIST_PATHS, `/invoices/${input.id}`, "/projects", "/"],
});

export const issueDraftAction = apiAction<IssueDraftInput, InvoiceResponseDto>({
  call: ({ id }, api) => api.POST("/api/v1/invoices/{id}/issue", { params: { path: { id } } }),
  revalidate: (input) => [...LIST_PATHS, `/invoices/${input.id}`],
});

/** The BE refuses an archived invoice (DT-128) and one with allocations (`INTEGRITY_LOCK`). */
export const voidInvoiceAction = apiAction<VoidInvoiceInput, InvoiceResponseDto>({
  call: ({ id, reason }, api) =>
    api.POST("/api/v1/invoices/{id}/void", { params: { path: { id } }, body: { reason } }),
  revalidate: (input) => [...LIST_PATHS, `/invoices/${input.id}`, "/projects", "/"],
});

export const archiveInvoiceAction = apiAction<ArchiveInvoiceInput, InvoiceResponseDto>({
  call: ({ id }, api) => api.POST("/api/v1/invoices/{id}/archive", { params: { path: { id } } }),
  revalidate: LIST_PATHS,
});

/** Restore (trash grant): the BE answers `CONFLICT` with the trash key when the client or a project is archived (DT-133). */
export const restoreInvoiceAction = apiAction<ArchiveInvoiceInput, RestoredInvoiceResponseDto>({
  call: ({ id }, api) => api.POST("/api/v1/invoices/{id}/restore", { params: { path: { id } } }),
  revalidate: (input) => [...LIST_PATHS, `/invoices/${input.id}`, "/trash"],
});

/** The PDF of the real invoice (`fileId` confirmed by the upload adapter), or `null` to detach it (HU-11 CA4). */
export const attachInvoiceFileAction = apiAction<AttachInvoiceFileInput, InvoiceResponseDto>({
  call: ({ id, fileId }, api) =>
    api.PUT("/api/v1/invoices/{id}/file", { params: { path: { id } }, body: { fileId } }),
  revalidate: (input) => [`/invoices/${input.id}`],
});

const listBillable = apiAction<ListOpenInvoicesInput, unknown[]>({
  call: ({ clientId }, api) =>
    api.GET("/api/v1/clients/{id}/billable-installments", { params: { path: { id: clientId } } }),
});

/**
 * Read of the "Facturar cuotas" options when the client changes in the form. The wire `code: null` is parsed to
 * `undefined` through `billableInstallmentRowSchema`.
 */
export async function listBillableInstallmentsAction(
  input: ListOpenInvoicesInput,
): Promise<ActionResult<BillableInstallmentRow[]>> {
  if (!idSchema.safeParse(input.clientId).success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await listBillable(input);
  return result.ok
    ? { ok: true, data: result.data.map((row) => billableInstallmentRowSchema.parse(row)) }
    : result;
}

const listInvoices = apiAction<z.output<typeof invoiceFiltersSchema>, InvoiceListResponseDto>({
  call: (filter, api) =>
    api.GET("/api/v1/invoices", { params: { query: toInvoiceListQuery(filter) } }),
});

/**
 * The invoices table reloads its rows through this read when the URL query changes. The filter is checked for UX
 * only (a bad sort never leaves the FE); the BE re-validates and decides who may read.
 */
export async function listInvoicesAction(
  input: InvoiceFilterInput,
): Promise<ActionResult<InvoiceListResponseDto>> {
  const parsed = invoiceFiltersSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listInvoices(parsed.data);
}

const searchInvoicesInputSchema = z.object({ q: z.string().trim().max(200).default("") });

const searchInvoices = apiAction<{ q: string }, InvoiceListResponseDto>({
  call: ({ q }, api) =>
    api.GET("/api/v1/invoices", {
      params: { query: { ...(q ? { q } : {}), pageSize: 25, archived: "exclude" } },
    }),
});

/**
 * Async invoice combobox (rule 12): the BE has no `/invoices/search`, so this lists `GET /api/v1/invoices?q`
 * (25 rows, archived excluded) and keeps the first 20 as `EntityRef`, the wire `code: null` parsed to `undefined`.
 */
export async function searchInvoicesAction(
  input: z.input<typeof searchInvoicesInputSchema>,
): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchInvoicesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await searchInvoices(parsed.data);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items.slice(0, 20).map((row) =>
      entityRefSchema.parse({
        type: "INVOICE",
        id: row.id,
        code: row.code,
        label: row.invoiceNumber,
      }),
    ),
  };
}
