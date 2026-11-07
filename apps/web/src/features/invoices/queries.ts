import "server-only";
import { toActionResult, type ApiResponseLike } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type {
  InvoiceListResponseDto,
  InvoiceResponseDto,
  InvoicesOverviewDto,
} from "@/lib/api/types/invoices";
import { idSchema } from "@/lib/validators/common";
import {
  billableInstallmentRowSchema,
  invoiceFiltersSchema,
  type BillableInstallmentRow,
} from "@/lib/validators/invoices";
import { ServiceError } from "@/lib/service-error";
import { toInvoiceListQuery } from "./api-query";
import type { InvoiceFilterInput } from "./components/invoice-table-query";

// Reads for the invoices pages (RSC), over the generated client. Pages call `notFound()` when `getInvoice` throws a
// `ServiceError` with code `NOT_FOUND`; the BE decides who may read (Member and Viewer get `FORBIDDEN`).

/**
 * Unwraps a read. A BE `404` throws `ServiceError("NOT_FOUND")`, `403` `FORBIDDEN` and `422` `VALIDATION`, keeping
 * the message and field errors: other modules (notes, invoices form options) catch these until CLEAN replaces
 * `@/lib/service-error` and its consumers.
 */
function unwrap<T>(result: ApiResponseLike<T>, what: string): T {
  const mapped = toActionResult(result);
  if (mapped.ok) return mapped.data;
  const { code, message, fieldErrors, entity } = mapped.error;
  if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION") {
    throw new ServiceError(code, {
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      ...(entity ? { entity } : {}),
    });
  }
  throw new Error(`${what} failed with ${result.response.status}`);
}

/** One page of `/invoices/list` for the URL query; `includeArchived` is part of the filter schema. */
export async function listInvoices(
  input: InvoiceFilterInput = {},
): Promise<InvoiceListResponseDto> {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/invoices", {
      params: { query: toInvoiceListQuery(invoiceFiltersSchema.parse(input)) },
    }),
    "GET /api/v1/invoices",
  );
}

/** The `/invoices` overview (`FORBIDDEN` without `read`, DT-175). */
export async function getInvoicesOverview(): Promise<InvoicesOverviewDto> {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/invoices/overview"), "GET /api/v1/invoices/overview");
}

/** A malformed id answers like an unknown one (`NOT_FOUND`), without calling the BE. */
export async function getInvoice(id: string): Promise<InvoiceResponseDto> {
  if (!idSchema.safeParse(id).success) {
    throw new ServiceError("NOT_FOUND");
  }
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/invoices/{id}", { params: { path: { id } } }),
    `GET /api/v1/invoices/${id}`,
  );
}

/**
 * Pending installments of the client's projects, for the "Facturar cuotas" wizard
 * (`GET /api/v1/clients/{id}/billable-installments`). The wire `code: null` is parsed to `undefined`.
 */
export async function listBillableInstallments(
  clientId: string,
): Promise<BillableInstallmentRow[]> {
  if (!idSchema.safeParse(clientId).success) {
    throw new ServiceError("NOT_FOUND");
  }
  const api = await getServerApi();
  const rows = unwrap(
    await api.GET("/api/v1/clients/{id}/billable-installments", {
      params: { path: { id: clientId } },
    }),
    `GET /api/v1/clients/${clientId}/billable-installments`,
  );
  return rows.map((row) => billableInstallmentRowSchema.parse(row));
}
