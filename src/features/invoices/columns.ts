import type { TableFacetDescriptor } from "@/lib/table-query";

/**
 * Columns and facets of the `/invoices/list` table (PRD §8.5). Pure data: no server code, safe in client
 * components. The sortable column ids are fields of `INVOICE_SORT_FIELDS` (`invoiceFiltersSchema`).
 */

export const INVOICE_COLUMN_IDS = [
  "invoiceNumber",
  "client",
  "issueDate",
  "dueDate",
  "total",
  "balance",
  "balanceUsd",
  "status",
] as const;
export type InvoiceColumnId = (typeof INVOICE_COLUMN_IDS)[number];

/**
 * Facets of the invoices table, in the ids `toModuleQuery` maps onto `invoiceFiltersSchema`: `clientId` is an
 * async facet and the issue-date range maps to `dateFrom` / `dateTo`.
 */
export const INVOICE_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "clientId", kind: "async" },
  { id: "currency", kind: "options" },
  { id: "issued", kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo" },
];
