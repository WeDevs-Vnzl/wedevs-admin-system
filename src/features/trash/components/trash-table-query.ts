import { toModuleQuery, type TableFacetDescriptor } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import type { TrashFilterInput } from "@/lib/validators/trash";

/**
 * Facets of the `/settings/trash` table. Pure data (no server code, no `"use client"`), so the server page and
 * the client table read the same page for a URL.
 */
export const TRASH_FACETS: readonly TableFacetDescriptor[] = [
  { id: "entityType", kind: "options" },
  { id: "deleted", kind: "dateRange", fromKey: "deletedFrom", toKey: "deletedTo" },
];

/** The table's list query as the trash filter. */
export function trashFilterOf(query: ListQuery): TrashFilterInput {
  return toModuleQuery(query, TRASH_FACETS) as TrashFilterInput;
}
