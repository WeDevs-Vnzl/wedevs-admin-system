import { toModuleQuery, type TableFacetDescriptor } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { DocumentFilterInput } from "@/lib/validators/documents";

/**
 * Columns and facets of the `/documents/list` table (PRD §8.9.5 "Tabla"). Pure data and functions: no server code
 * and no `"use client"`, so the server page and the client table read the same page for a URL. The sortable column
 * ids are fields of `DOCUMENT_SORT_FIELDS`.
 */

export const DOCUMENT_COLUMN_IDS = [
  "code",
  "title",
  "category",
  "type",
  "status",
  "format",
  "versionNumber",
  "links",
  "expiresAt",
  "shared",
  "updatedAt",
] as const;

/** Facet ids as `toModuleQuery` maps them onto `documentFilterSchema`; the expiry range goes to `expiresFrom/To`. */
export const DOCUMENT_FACETS: readonly TableFacetDescriptor[] = [
  { id: "status", kind: "options" },
  { id: "categoryId", kind: "options" },
  { id: "typeId", kind: "options" },
  { id: "format", kind: "options" },
  { id: "clientId", kind: "async" },
  { id: "projectId", kind: "async" },
  { id: "shared", kind: "options" },
  { id: "expires", kind: "dateRange", fromKey: "expiresFrom", toKey: "expiresTo" },
];

/**
 * The table's list query as the documents filter. `shared` is one yes/no value: with both options chosen it
 * filters nothing. Filters that are not facets (the overview shortcuts `expiringWithinDays` and `staleDraft`)
 * pass through under their own names.
 */
export function documentFilterOf(query: ListQuery): DocumentFilterInput {
  const filter = toModuleQuery(query, DOCUMENT_FACETS);
  if (Array.isArray(filter.shared)) delete filter.shared;
  return filter as DocumentFilterInput;
}

/** `/documents/list` opened with these filters in its URL state (`?filters=<json>`). */
export function documentsListHref(filters: Record<string, string>): string {
  return `/documents/list?filters=${encodeURIComponent(JSON.stringify(filters))}`;
}
