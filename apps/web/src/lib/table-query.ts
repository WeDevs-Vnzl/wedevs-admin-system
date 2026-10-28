import type { ListQuery } from "@/lib/validators/common";

/** Optional own query keys of a date-range facet; they default to `<id>From` / `<id>To`. */
export interface DateRangeFacetKeys {
  /** Query key that receives the range start (`YYYY-MM-DD`). */
  fromKey?: string;
  /** Query key that receives the range end (`YYYY-MM-DD`). */
  toKey?: string;
}

/**
 * The part of a table facet that `toModuleQuery` needs. It lives in `lib` so the data-table kit can
 * import it while `lib` never imports from `components`; the kit's `FacetConfig` is assignable to it.
 */
export type TableFacetDescriptor =
  | { id: string; kind: "options" | "async" }
  | ({ id: string; kind: "dateRange" } & DateRangeFacetKeys);

/** Keys the list query owns; a stray filter with one of these names never overrides them. */
const BASE_KEYS = new Set(["page", "pageSize", "sort", "q", "includeArchived", "filters"]);

/** Keys that would reach the prototype chain of the output object; never assigned (URL state is user input). */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Bridges the kit's `ListQuery` (`filters` is a nested map keyed by facet id) to the flat input a module's
 * filter schema expects (`invoiceFiltersSchema`, `shareFilterSchema`…):
 *
 * - `page`, `pageSize`, `sort`, `q` and `includeArchived` pass through;
 * - an `options`/`async` facet becomes a top-level field with the same id (a scalar for one value, else a
 *   list);
 * - a `dateRange` facet `[from, to]` becomes `<fromKey>` and `<toKey>` (default `<id>From` / `<id>To`);
 * - empty facets are dropped, and a filter that is not a declared facet is passed through under its id.
 *
 * The result is the *input* of the module schema, which still validates and coerces it.
 */
export function toModuleQuery(
  query: ListQuery,
  facets: readonly TableFacetDescriptor[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    page: query.page,
    pageSize: query.pageSize,
    includeArchived: query.includeArchived,
  };
  if (query.sort !== undefined) out.sort = query.sort;
  if (query.q !== undefined) out.q = query.q;

  const byId = new Map(facets.map((facet) => [facet.id, facet] as const));
  for (const [id, raw] of Object.entries(query.filters)) {
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length === 0 || values.every((value) => value === "")) continue;

    const facet = byId.get(id);
    if (facet?.kind === "dateRange") {
      const [from, to] = values;
      const fromKey = facet.fromKey ?? `${id}From`;
      const toKey = facet.toKey ?? `${id}To`;
      if (from) assign(out, fromKey, from);
      if (to) assign(out, toKey, to);
      continue;
    }
    // A one-element list is sent as a scalar: list-or-scalar fields (`facetSchema`) accept both, and
    // single-value fields (a module's own scalar filter) accept only the scalar.
    assign(out, id, values.length === 1 ? values[0] : raw);
  }
  return out;
}

function assign(out: Record<string, unknown>, key: string, value: unknown): void {
  if (BASE_KEYS.has(key) || UNSAFE_KEYS.has(key)) return;
  out[key] = value;
}
