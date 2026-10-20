import type { TableFacetDescriptor } from "@/lib/table-query";

/**
 * Facets of the `/expenses/list` table and the module keys they map to: status, category, account and project
 * reach the filter under their own ids (lists), the date range becomes `dateFrom` / `dateTo`.
 */
export const EXPENSE_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "categoryId", kind: "options" },
  { id: "accountId", kind: "options" },
  { id: "projectId", kind: "options" },
  { id: "date", kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo" },
];
