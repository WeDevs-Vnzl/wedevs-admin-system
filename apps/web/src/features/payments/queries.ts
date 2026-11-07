import "server-only";
import { toActionResult, type ApiResponseLike } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import { idSchema } from "@/lib/validators/common";
import { paymentFiltersSchema, type PaymentFilters } from "@/lib/validators/payments";
import { ServiceError } from "@/lib/service-error";
import { toPaymentListQuery } from "./api-query";
import { toOpenInvoiceOption } from "./open-invoice";
import type { OpenInvoiceOption } from "./types";

// Reads for the payment pages (RSC, PRD §8.6) over the generated client. A refused read throws `ServiceError` with
// the BE's code (`404` → NOT_FOUND, `403` → FORBIDDEN, `422` → VALIDATION), the contract the pages catch.

/** Unwraps a read or throws the BE's code as a `ServiceError`. */
function unwrap<T>(response: ApiResponseLike<T>): T {
  const result = toActionResult(response);
  if (result.ok) return result.data;
  // MOCK — until cleanup: `ServiceError` stays the read-failure contract until CLEAN replaces `@/lib/service-error`.
  throw new ServiceError(result.error.code, {
    message: result.error.message,
    ...(result.error.fieldErrors ? { fieldErrors: result.error.fieldErrors } : {}),
  });
}

/** A malformed id answers the same as an unknown one and never reaches the BE. */
function pathId(id: string): string {
  const parsed = idSchema.safeParse(id);
  // MOCK — until cleanup: see `unwrap`.
  if (!parsed.success) throw new ServiceError("NOT_FOUND");
  return parsed.data;
}

/** `GET /api/v1/payments/overview` (DT-175): `FORBIDDEN` without the payment read grant. */
export async function getPaymentsOverview() {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/payments/overview"));
}

/** The table's first page: the URL query parsed with the same filter schema as `listPaymentsAction`. */
export async function listPayments(input: Record<string, unknown> = {}) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/payments", {
      params: { query: toPaymentListQuery(paymentFiltersSchema.parse(input)) },
    }),
  );
}

export async function getPayment(id: string) {
  const path = pathId(id);
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/payments/{id}", { params: { path: { id: path } } }));
}

/** The client's unapplied credit (HU-13 CA5), as the BE sums it. */
export async function getClientCredit(clientId: string) {
  const path = pathId(clientId);
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/clients/{id}/credit", { params: { path: { id: path } } }));
}

/** Invoices of the client that still take a payment ("Aplicar a facturas", HU-13 CA1). */
export async function listOpenInvoices(clientId: string): Promise<OpenInvoiceOption[]> {
  const path = pathId(clientId);
  const api = await getServerApi();
  const rows = unwrap(
    await api.GET("/api/v1/clients/{id}/open-invoices", { params: { path: { id: path } } }),
  );
  return rows.map(toOpenInvoiceOption);
}

/**
 * The client and the open invoice `/payments/new?invoiceId=` starts from. `null` when the invoice takes no payment
 * (the BE's `404`, DT-133) and for a malformed id (no call): the page then opens the empty form.
 */
export async function getInvoiceForPayment(
  invoiceId: string,
): Promise<{ client: { id: string; label: string }; invoice: OpenInvoiceOption } | null> {
  const parsed = idSchema.safeParse(invoiceId);
  if (!parsed.success) return null;
  const api = await getServerApi();
  const result = toActionResult(
    await api.GET("/api/v1/invoices/{id}/payment-context", {
      params: { path: { id: parsed.data } },
    }),
  );
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") return null;
    // MOCK — until cleanup: see `unwrap`.
    throw new ServiceError(result.error.code, { message: result.error.message });
  }
  return { client: result.data.client, invoice: toOpenInvoiceOption(result.data.invoice) };
}

export type { PaymentFilters };
