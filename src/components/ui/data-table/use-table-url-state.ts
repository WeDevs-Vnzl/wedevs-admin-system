"use client";

import { useCallback, useMemo } from "react";
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsJson,
  parseAsString,
  useQueryStates,
} from "nuqs";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_VALUES,
  listFiltersSchema,
  listQuerySchema,
  parseSort,
  type ListFilters,
  type ListQuery,
  type PageSize,
} from "@/lib/validators/common";
import type { ListQueryPatch } from "./types";

const MAX_QUERY_LENGTH = 200;

/**
 * URL keys of the table state (nuqs). `filters` is one JSON value so every module's facets round-trip
 * without a parser per facet; `archived` maps to `ListQuery.includeArchived`.
 */
export const tableUrlParsers = {
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  sort: parseAsString,
  q: parseAsString,
  archived: parseAsBoolean.withDefault(false),
  filters: parseAsJson(listFiltersSchema).withDefault({}),
};

export interface TableUrlState {
  page: number;
  pageSize: number;
  sort: string | null;
  q: string | null;
  archived: boolean;
  filters: ListFilters;
}

/** Any page size outside 25/50/100 (typed or hand-edited in the URL) falls back to the default. */
export function guardPageSize(value: unknown): PageSize {
  const size = typeof value === "number" ? value : Number(value);
  return PAGE_SIZE_VALUES.find((allowed) => allowed === size) ?? DEFAULT_PAGE_SIZE;
}

/** `ListQuery` → URL state. Unset optional values become `null` so nuqs drops the key. */
export function listQueryToUrlState(query: ListQuery): TableUrlState {
  return {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort ?? null,
    q: query.q ?? null,
    archived: query.includeArchived,
    filters: query.filters,
  };
}

/**
 * URL state → `ListQuery`. Invalid parts are dropped one by one instead of rejecting the whole query, so a
 * hand-edited URL still renders the table. The result always satisfies `listQuerySchema`.
 */
export function urlStateToListQuery(state: Partial<TableUrlState>): ListQuery {
  const page = Number.isInteger(state.page) && (state.page ?? 0) >= 1 ? state.page : 1;
  const sort = state.sort && parseSort(state.sort) ? state.sort : undefined;
  const q = typeof state.q === "string" ? state.q.slice(0, MAX_QUERY_LENGTH) : undefined;
  const filters = listFiltersSchema.safeParse(state.filters);

  return listQuerySchema.parse({
    page,
    pageSize: guardPageSize(state.pageSize),
    sort,
    q,
    includeArchived: state.archived === true,
    filters: filters.success ? filters.data : {},
  });
}

/** Applies a patch to a query, returning the URL state to write. Any patch without `page` returns to page 1 (search, filter, sort and page-size changes). */
export function patchToUrlState(current: ListQuery, patch: ListQueryPatch): TableUrlState {
  const next: ListQuery = { ...current, ...patch, page: patch.page ?? 1 };
  return listQueryToUrlState(next);
}

/** Table state bound to the URL. `query` is always valid; `setQuery` writes a patch and resets the page on changes. */
export function useTableUrlState() {
  const [state, setState] = useQueryStates(tableUrlParsers, { history: "replace" });
  const query = useMemo(() => urlStateToListQuery(state), [state]);

  const setQuery = useCallback(
    (patch: ListQueryPatch) => {
      void setState(patchToUrlState(query, patch));
    },
    [query, setState],
  );

  return { query, setQuery };
}
