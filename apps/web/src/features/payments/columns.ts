import type { TableFacetDescriptor } from "@/lib/table-query";

/**
 * Facets of the `/payments/list` table, in the ids `toModuleQuery` maps onto `paymentFiltersSchema`: the
 * option facets keep their filter key, the date range maps to `dateFrom` / `dateTo`. Pure data, safe in client
 * components.
 */
export const PAYMENT_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "clientId", kind: "async" },
  { id: "accountId", kind: "options" },
  { id: "methodId", kind: "options" },
  { id: "currency", kind: "options" },
  { id: "date", kind: "dateRange", fromKey: "dateFrom", toKey: "dateTo" },
  { id: "hasUnallocated", kind: "options" },
];
