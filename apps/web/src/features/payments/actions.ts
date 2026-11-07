"use server";

import { apiAction, type RevalidateTarget } from "@/lib/api/action";
import type {
  AllocatePaymentDto,
  CreatePaymentDto,
  DuplicatePaymentQuery,
  DuplicatePaymentResponseDto,
  OpenInvoiceResponseDto,
  PaymentAllocationResponseDto,
  PaymentListResponseDto,
  PaymentResponseDto,
  SetPaymentStatusDto,
  UpdatePaymentDto,
} from "@/lib/api/types/payments";
import {
  entityRefSchema,
  errorMessageKey,
  idSchema,
  type ActionResult,
  type EntityRef,
} from "@/lib/validators/common";
import {
  paymentFiltersSchema,
  searchPaymentsInputSchema,
  type SearchPaymentsInput,
} from "@/lib/validators/payments";
import { toPaymentListQuery } from "./api-query";
import { toOpenInvoiceOption } from "./open-invoice";
import type { OpenInvoiceOption } from "./types";

// Thin API proxies (C10, PRD §8.6, HU-13, HU-14): token → one BE call → error mapping → revalidate. The BE decides
// every grant and every money rule (allocatable, net credited, the USD snapshot, the limits); the FE never checks
// `can()` or computes a persisted amount here. Amounts travel as decimal strings (C15).

// A payment moves invoice balances, account balances and client credit, so those layouts refresh with the payments.
const PAYMENT_PATHS: readonly RevalidateTarget[] = [
  { path: "/payments", type: "layout" },
  { path: "/invoices", type: "layout" },
  { path: "/accounts", type: "layout" },
  { path: "/", type: "layout" },
];
const paymentPage = (id: string): RevalidateTarget => ({ path: `/payments/${id}`, type: "page" });

// The forms validate for UX and hand over the parsed values; the commands take the BE's own body types (C8), plus
// the id the path needs.
type UpdatePaymentCommand = UpdatePaymentDto & { id: string };
type SetPaymentStatusCommand = SetPaymentStatusDto & { id: string };
type AllocatePaymentCommand = AllocatePaymentDto & { paymentId: string };
type DeallocatePaymentCommand = { allocationId: string };

const listPayments = apiAction<Record<string, unknown>, PaymentListResponseDto>({
  call: (input, api) =>
    api.GET("/api/v1/payments", {
      params: { query: toPaymentListQuery(paymentFiltersSchema.parse(input)) },
    }),
});

/**
 * The `/payments/list` table reloads its rows through this read when the URL query changes. The filter is checked
 * for UX only (a bad sort never leaves the FE); the BE re-validates and decides who may read.
 */
export async function listPaymentsAction(
  input: Record<string, unknown>,
): Promise<ActionResult<PaymentListResponseDto>> {
  if (!paymentFiltersSchema.safeParse(input).success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listPayments(input);
}

export const createPaymentAction = apiAction<CreatePaymentDto, PaymentResponseDto>({
  call: (input, api) => api.POST("/api/v1/payments", { body: input }),
  revalidate: PAYMENT_PATHS,
});

/** Edit a payment (Q-FEINT-11 (A)); allocations change only through (de)allocate. */
export const updatePaymentAction = apiAction<UpdatePaymentCommand, PaymentResponseDto>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/payments/{id}", { params: { path: { id } }, body }),
  revalidate: (input) => [...PAYMENT_PATHS, paymentPage(input.id)],
});

/** Confirm or void (with a reason); voiding removes the allocations, which the response shows. */
export const setPaymentStatusAction = apiAction<SetPaymentStatusCommand, PaymentResponseDto>({
  call: ({ id, ...body }, api) =>
    api.POST("/api/v1/payments/{id}/status", { params: { path: { id } }, body }),
  revalidate: (input) => [...PAYMENT_PATHS, paymentPage(input.id)],
});

/** Apply (part of) a confirmed payment to one open invoice, both amounts as the user saw them (HU-13 CA4). */
export const allocatePaymentAction = apiAction<
  AllocatePaymentCommand,
  PaymentAllocationResponseDto
>({
  call: ({ paymentId, ...body }, api) =>
    api.POST("/api/v1/payments/{id}/allocations", { params: { path: { id: paymentId } }, body }),
  revalidate: (input) => [...PAYMENT_PATHS, paymentPage(input.paymentId)],
});

export const deallocatePaymentAction = apiAction<DeallocatePaymentCommand, PaymentResponseDto>({
  call: ({ allocationId }, api) =>
    api.POST("/api/v1/allocations/{id}/deallocate", { params: { path: { id: allocationId } } }),
  revalidate: PAYMENT_PATHS,
});

/** Possible duplicate of a reference (HU-13 CA6): a read, shown as a warning before saving. */
export const detectDuplicatePaymentAction = apiAction<
  DuplicatePaymentQuery,
  DuplicatePaymentResponseDto
>({
  call: (query, api) => api.GET("/api/v1/payments/duplicates", { params: { query } }),
});

const openInvoices = apiAction<{ clientId: string }, OpenInvoiceResponseDto[]>({
  call: ({ clientId }, api) =>
    api.GET("/api/v1/clients/{id}/open-invoices", { params: { path: { id: clientId } } }),
});

/** Open invoices of a client for the "Aplicar a facturas" section and the allocation sheet (HU-13 CA1). */
export async function listOpenInvoicesAction(input: {
  clientId: string;
}): Promise<ActionResult<OpenInvoiceOption[]>> {
  if (!idSchema.safeParse(input.clientId).success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await openInvoices(input);
  return result.ok ? { ok: true, data: result.data.map(toOpenInvoiceOption) } : result;
}

const searchPayments = apiAction<{ q: string }, PaymentListResponseDto>({
  call: ({ q }, api) =>
    api.GET("/api/v1/payments", { params: { query: { ...(q ? { q } : {}), pageSize: 25 } } }),
});

/**
 * Async payment combobox of the note link picker and the document links (frozen): the BE has no
 * `/payments/search`, so this reads the list route with `q`, keeps the first 20 rows and returns them as
 * `EntityRef`s (rule 12).
 */
export async function searchPaymentsAction(
  input: SearchPaymentsInput,
): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchPaymentsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await searchPayments(parsed.data);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items
      .slice(0, 20)
      .map((row) =>
        entityRefSchema.parse({ type: "PAYMENT", id: row.id, code: row.code, label: row.code }),
      ),
  };
}
