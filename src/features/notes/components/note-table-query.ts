import { toModuleQuery, type TableFacetDescriptor } from "@/lib/table-query";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_VALUES,
  listFiltersSchema,
  parseSort,
  type ListFilters,
  type ListQuery,
} from "@/lib/validators/common";
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
 * The kit's list query as the notes list filter. An invalid filter falls back to the default list instead of
 * failing the request: a hand-edited URL still renders the table.
 */
export function toNoteFilter(query: ListQuery): NoteFilterInput {
  const input = toModuleQuery(query, NOTE_TABLE_FACETS);
  return noteFilterSchema.safeParse(input).success ? (input as NoteFilterInput) : {};
}

/** The URL state of the notes table (the keys of the kit's `useTableUrlState`), read on the server. */
export interface NoteTableUrlState {
  page: number;
  pageSize: number;
  sort: string | null;
  q: string | null;
  filters: ListFilters;
}

/** URL state → notes list filter, for the first server render of `/notes`. */
export function noteFilterFromUrlState(state: NoteTableUrlState): NoteFilterInput {
  const pageSize = PAGE_SIZE_VALUES.find((size) => size === state.pageSize) ?? DEFAULT_PAGE_SIZE;
  const filters = listFiltersSchema.safeParse(state.filters);
  return toNoteFilter({
    page: Number.isInteger(state.page) && state.page >= 1 ? state.page : 1,
    pageSize,
    sort: state.sort && parseSort(state.sort) ? state.sort : undefined,
    q: state.q ?? undefined,
    includeArchived: false,
    filters: filters.success ? filters.data : {},
  });
}
