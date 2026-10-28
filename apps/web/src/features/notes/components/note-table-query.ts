import { toModuleQuery, type TableFacetDescriptor } from "@/lib/table-query";
import type { ListQuery } from "@/lib/validators/common";
import { noteFilterSchema, type NoteFilterInput } from "@/lib/validators/notes";

/**
 * Facets of `/notes`. The ids and kinds equal the CSV export source's (`exportNotesCsvAction`), so the table and
 * the export read the same filter.
 */
export const NOTE_TABLE_FACETS: readonly TableFacetDescriptor[] = [
  { id: "authorId", kind: "async" },
  { id: "tagId", kind: "async" },
  { id: "linkedEntityType", kind: "options" },
  { id: "createdAt", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
];

/**
 * The kit's list query as the notes list filter. Notes have no archived view, so `includeArchived` never reaches
 * the service (a hand-edited `?archived=true` changes nothing). An invalid filter falls back to the default list
 * instead of failing the request: a hand-edited URL still renders the table.
 */
export function toNoteFilter(query: ListQuery): NoteFilterInput {
  const input = { ...toModuleQuery(query, NOTE_TABLE_FACETS), includeArchived: false };
  return noteFilterSchema.safeParse(input).success ? (input as NoteFilterInput) : {};
}
