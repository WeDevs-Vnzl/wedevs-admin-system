"use server";

import { apiAction } from "@/lib/api/action";
import type {
  ClientArchiveResultDto,
  ClientDetailDto,
  ClientListResponseDto,
  ClientsArchiveResultDto,
  EntityRefDto,
} from "@/lib/api/types/clients";
import {
  archiveClientInputSchema,
  archiveClientsInputSchema,
  clientFilterSchema,
  type ClientFilterInput,
  type CreateClientFormValues,
  type RestoreClientInput,
  type SetClientStatusInput,
  type UpdateClientFormValues,
  type ClientListRowDTO,
  type ClientFilter,
} from "@/lib/validators/clients";
import {
  entityRefSchema,
  errorMessageKey,
  listQuerySchema,
  type ActionResult,
  type EntityRef,
} from "@/lib/validators/common";
import type { z } from "@/lib/validators/zod";
import type { ExportSource } from "@/lib/validators/export";
import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { toClientListQuery } from "./api-query";
import { CLIENT_EXPORT_COLUMNS, CLIENT_FACETS } from "./columns";

// Thin API proxies (C10): token → one BE call → error mapping → revalidate. The BE decides every grant; the
// FE never checks `can()` here. Mutations revalidate the whole `/clients` subtree: overview, table and every
// detail page.
const REVALIDATE = [{ path: "/clients", type: "layout" }] as const;

/** Creates a client; the BE allocates the `CLI-` code and answers `CONFLICT` with the holder on a duplicate tax id. */
/** The editable fields only: the edit form also carries `id`, which never goes in the body. */
function clientBody(input: Omit<UpdateClientFormValues, "id">) {
  return {
    kind: input.kind,
    tradeName: input.tradeName,
    legalName: input.legalName,
    taxId: input.taxId,
    country: input.country,
    address: input.address,
    phone: input.phone,
    email: input.email,
    website: input.website,
    tagIds: input.tagIds ?? [],
  };
}

export const createClientAction = apiAction<CreateClientFormValues, ClientDetailDto>({
  call: (input, api) =>
    api.POST("/api/v1/clients", {
      body: { ...clientBody(input), status: input.status ?? "PROSPECTO" },
    }),
  revalidate: REVALIDATE,
});

export const updateClientAction = apiAction<UpdateClientFormValues, ClientDetailDto>({
  call: (input, api) =>
    api.PATCH("/api/v1/clients/{id}", {
      params: { path: { id: input.id } },
      body: clientBody(input),
    }),
  revalidate: REVALIDATE,
});

export const setClientStatusAction = apiAction<SetClientStatusInput, ClientDetailDto>({
  call: ({ id, status }, api) =>
    api.POST("/api/v1/clients/{id}/status", { params: { path: { id } }, body: { status } }),
  revalidate: REVALIDATE,
});

/** Archive; a client with active projects or open invoices needs `confirm: true` (`INTEGRITY_LOCK` otherwise). */
export const archiveClientAction = apiAction<
  z.input<typeof archiveClientInputSchema>,
  ClientArchiveResultDto
>({
  call: ({ id, confirm }, api) =>
    api.POST("/api/v1/clients/{id}/archive", {
      params: { path: { id } },
      body: { confirm: confirm ?? false },
    }),
  revalidate: REVALIDATE,
});

export const archiveClientsAction = apiAction<
  z.input<typeof archiveClientsInputSchema>,
  ClientsArchiveResultDto
>({
  call: ({ ids, confirm }, api) =>
    api.POST("/api/v1/clients/archive", { body: { ids, confirm: confirm ?? false } }),
  revalidate: REVALIDATE,
});

/** Restore (trash grant; `CONFLICT` with `entity` when a live client holds the same tax id). */
export const restoreClientAction = apiAction<RestoreClientInput, ClientDetailDto>({
  call: ({ id }, api) => api.POST("/api/v1/clients/{id}/restore", { params: { path: { id } } }),
  revalidate: REVALIDATE,
});

const searchInputSchema = listQuerySchema.pick({ q: true });

const searchClients = apiAction<{ q?: string }, EntityRefDto[]>({
  call: ({ q }, api) =>
    api.GET("/api/v1/clients/search", { params: { query: { ...(q ? { q } : {}), limit: 20 } } }),
});

/**
 * Typeahead for every client combobox: up to 20 live clients as `EntityRef`s. The wire `code: null` is parsed to
 * `undefined` (`entityRefSchema`), so consumers keep the `EntityRef` they always read.
 */
export async function searchClientsAction(
  input: z.input<typeof searchInputSchema>,
): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await searchClients(parsed.data);
  return result.ok
    ? { ok: true, data: result.data.map((ref) => entityRefSchema.parse(ref)) }
    : result;
}

const listClients = apiAction<ClientFilter, ClientListResponseDto>({
  call: (filter, api) =>
    api.GET("/api/v1/clients", { params: { query: toClientListQuery(filter) } }),
});

/**
 * The clients table reloads its rows through this read when the URL query changes. The filter is checked for UX
 * only; the BE re-validates (a money sort without the grant answers `VALIDATION` on `sort`).
 */
export async function listClientsAction(
  input: ClientFilterInput,
): Promise<ActionResult<ClientListResponseDto>> {
  const parsed = clientFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listClients(parsed.data);
}

const exportSource: ExportSource<ClientListRowDTO, ClientFilter> = {
  entity: "CLIENT",
  facets: CLIENT_FACETS,
  filterSchema: clientFilterSchema,
  columns: CLIENT_EXPORT_COLUMNS,
};

/** CSV of the clients table: same filter schema and columns as the table (PD-2); the BE builds the file. */
export const exportClientsCsvAction = defineCsvExportAction({
  entity: "CLIENT",
  source: exportSource,
  namespace: "clients",
});
