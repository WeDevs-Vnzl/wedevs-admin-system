import "server-only";
import type { ApiResponseLike } from "@/lib/api/errors";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import type {
  ClientDetailDto,
  ClientListResponseDto,
  ClientSummaryResponseDto,
  ClientsOverviewDto,
} from "@/lib/api/types/clients";
import { clientFilterSchema, type ClientFilterInput } from "@/lib/validators/clients";
import { ServiceError } from "@/lib/service-error";
import { toClientListQuery } from "./api-query";

// Reads for the clients pages (RSC), over the generated client. Pages call `notFound()` when `getClient` throws a
// `ServiceError` with code `NOT_FOUND`.

/**
 * Unwraps a read. A BE `404` throws `ServiceError("NOT_FOUND")`, `403` `FORBIDDEN` and `422` `VALIDATION`: other
 * modules (documents, notes, projects) catch these until CLEAN replaces `@/lib/service-error` and its consumers.
 */
function unwrap<T>(result: ApiResponseLike<T>, what: string): T {
  const mapped = toActionResult(result);
  if (mapped.ok) return mapped.data;
  const { code, message, fieldErrors } = mapped.error;
  if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION") {
    throw new ServiceError(code, { message, ...(fieldErrors ? { fieldErrors } : {}) });
  }
  throw new Error(`${what} failed with ${result.response.status}`);
}

export async function listClients(input: ClientFilterInput = {}): Promise<ClientListResponseDto> {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/clients", {
      params: { query: toClientListQuery(clientFilterSchema.parse(input)) },
    }),
    "GET /api/v1/clients",
  );
}

export async function getClient(id: string): Promise<ClientDetailDto> {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/clients/{id}", { params: { path: { id } } }),
    `GET /api/v1/clients/${id}`,
  );
}

/**
 * The "Resumen" metrics and side panel figures (`GET /api/v1/clients/{id}/summary`). The BE refuses roles without
 * the financial grant with `403`, which surfaces as `ServiceError("FORBIDDEN")`; pages read it for finance roles.
 */
export async function getClientFinancials(id: string): Promise<ClientSummaryResponseDto> {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/clients/{id}/summary", { params: { path: { id } } }),
    `GET /api/v1/clients/${id}/summary`,
  );
}

/** The `/clients` overview; Member and Viewer get empty ranked lists and `null` money (DT-175). */
export async function getClientsOverview(): Promise<ClientsOverviewDto> {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/clients/overview"), "GET /api/v1/clients/overview");
}
