// MOCK — filtering, sorting and pagination over in-memory rows, shared by the Hito 1 mock services.
// Real services do this in SQL (Hito 2). Framework-free (C11).
import { paginated, parseSort, type ListQuery, type Paginated } from "@/lib/validators/common";

/** Lower-case and accent-fold a text, so `"Cotizacion"` matches `"Cotización"` (data-rules.md §7). */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

type SortValue = string | number | boolean | null;

export interface ListSpec<T> {
  /** Texts the free-text query `q` is matched against. */
  searchText: (row: T) => readonly (string | null | undefined)[];
  /** Sortable fields by name (the whitelist the filter schema enforces). */
  sorters: Record<string, (row: T) => SortValue>;
  /** Sort applied when the query has none (`field:asc|desc`). */
  defaultSort: string;
}

/** Ascending order of two non-null values. */
function compareValues(a: string | number | boolean, b: string | number | boolean): number {
  if (a === b) return 0;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
  }
  return a < b ? -1 : 1;
}

/** Applies `q`, the sort and the page window of `query` to `rows` (already filtered by the caller). */
export function listRows<T>(
  rows: readonly T[],
  query: Pick<ListQuery, "page" | "pageSize"> & {
    sort?: string | undefined;
    q?: string | undefined;
  },
  spec: ListSpec<T>,
): Paginated<T> {
  const needle = query.q ? foldText(query.q) : null;
  const matching = needle
    ? rows.filter((row) =>
        spec.searchText(row).some((text) => text != null && foldText(text).includes(needle)),
      )
    : [...rows];

  // A sort on a field the spec does not know falls back to the default one.
  const requested = parseSort(query.sort);
  const sort = requested && spec.sorters[requested.field] ? requested : parseSort(spec.defaultSort);
  const sorter = sort ? spec.sorters[sort.field] : undefined;
  if (sort && sorter) {
    const direction = sort.direction === "desc" ? -1 : 1;
    matching.sort((a, b) => {
      const left = sorter(a);
      const right = sorter(b);
      // Missing values go last whichever the direction.
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      return direction * compareValues(left, right);
    });
  }

  const start = (query.page - 1) * query.pageSize;
  return paginated(matching.slice(start, start + query.pageSize), matching.length, query);
}
