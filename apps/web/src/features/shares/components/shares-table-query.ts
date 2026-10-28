import { toModuleQuery, type TableFacetDescriptor } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { ShareFilterInput } from "@/lib/validators/shares";

/**
 * Columns and facets of the `/documents/shares` table. Pure data and functions (no server code, no `"use client"`),
 * so the server page and the client table read the same page for a URL. Sortable column ids are `SHARE_SORT_FIELDS`.
 */
export const SHARE_COLUMN_IDS = [
  "title",
  "client",
  "documents",
  "status",
  "expiresAt",
  "viewCount",
  "downloadCount",
  "failedUnlockCount",
  "lastAccessedAt",
  "createdAt",
] as const;

export const SHARE_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "clientId", kind: "async" },
  { id: "hasAccessKeys", kind: "options" },
  { id: "created", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
];

/** The table's list query as the shares filter. `hasAccessKeys` is one yes/no value: both chosen filter nothing. */
export function shareFilterOf(query: ListQuery): ShareFilterInput {
  const filter = toModuleQuery(query, SHARE_FACETS);
  if (Array.isArray(filter.hasAccessKeys)) delete filter.hasAccessKeys;
  return filter as ShareFilterInput;
}
