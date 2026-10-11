"use server";

import {
  archiveClientInputSchema,
  archiveClientsInputSchema,
  clientFilterSchema,
  createClientInputSchema,
  restoreClientInputSchema,
  setClientStatusInputSchema,
  updateClientInputSchema,
  type ClientListRowDTO,
  type ClientFilter,
} from "@/lib/validators/clients";
import { listQuerySchema } from "@/lib/validators/common";
import type { ExportSource } from "@/lib/validators/export";
import * as clients from "@/mocks/services/clients";
import { exportCsv } from "@/mocks/services/export";
import { defineAction } from "@/server/actions/define-action";
import type { ServiceContext } from "@/server/context";
import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { CLIENT_EXPORT_COLUMNS, CLIENT_FACETS } from "./columns";

// Mutations revalidate the whole `/clients` subtree: overview, table and every detail page (DT-71: each
// action declares a real `can()` grant).
const REVALIDATE = [{ path: "/clients", type: "layout" }] as const;

export const createClientAction = defineAction({
  permission: { action: "create", resource: "client" },
  input: createClientInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => clients.createClient(ctx, data),
});

export const updateClientAction = defineAction({
  permission: { action: "update", resource: "client" },
  input: updateClientInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => clients.updateClient(ctx, data),
});

export const setClientStatusAction = defineAction({
  permission: { action: "update", resource: "client" },
  input: setClientStatusInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => clients.setClientStatus(ctx, data),
});

/** Archive; a client with active projects or open invoices needs `confirm: true` (INTEGRITY_LOCK otherwise). */
export const archiveClientAction = defineAction({
  permission: { action: "delete", resource: "client" },
  input: archiveClientInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => clients.archiveClient(ctx, data),
});

export const archiveClientsAction = defineAction({
  permission: { action: "delete", resource: "client" },
  input: archiveClientsInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => clients.archiveClients(ctx, data),
});

/** Restore is governed by the trash grant (Owner and Admin, C19). */
export const restoreClientAction = defineAction({
  permission: { action: "restore", resource: "trash" },
  input: restoreClientInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => clients.restoreClient(ctx, data),
});

/** Typeahead for the client pickers (project form, note links): up to 20 live clients as `EntityRef`s. */
export const searchClientsAction = defineAction({
  permission: { action: "read", resource: "client" },
  input: listQuerySchema.pick({ q: true }),
  handler: (ctx, data) => clients.searchClients(ctx, { q: data.q, limit: 20 }),
});

const exportSource: ExportSource<ClientListRowDTO, ClientFilter, ServiceContext> = {
  entity: "CLIENT",
  facets: CLIENT_FACETS,
  filterSchema: clientFilterSchema,
  list: (ctx, filter) => clients.listClients(ctx, filter),
  columns: CLIENT_EXPORT_COLUMNS,
};

/** CSV of the clients table: same list service, filter schema and columns as the table (PD-2). */
export const exportClientsCsvAction = defineCsvExportAction({
  entity: "CLIENT",
  permission: { action: "read", resource: "client" },
  source: exportSource,
  exportCsv,
  namespace: "clients",
});
