import type { TableFacetDescriptor } from "@/lib/table-query";

/** Facets of `/accounts/list` (S15); the ids are the keys of `accountFilterSchema`. */
export const ACCOUNT_FACETS: readonly TableFacetDescriptor[] = [
  { id: "type", kind: "options" },
  { id: "currency", kind: "options" },
  { id: "status", kind: "options" },
];
