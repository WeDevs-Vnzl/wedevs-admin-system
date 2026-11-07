import type { TechnologyListQuery, TechnologyListSort } from "@/lib/api/types/taxonomy";
import type { TechnologyFilter } from "@/lib/validators/technologies";

/**
 * Sort tokens of `GET /api/v1/technologies`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const TECHNOLOGY_SORTS: Record<TechnologyListSort, true> = {
  "name:asc": true,
  "name:desc": true,
  "category:asc": true,
  "category:desc": true,
  "usageCount:asc": true,
  "usageCount:desc": true,
  "active:asc": true,
  "active:desc": true,
};

function isTechnologyListSort(value: string): value is TechnologyListSort {
  return Object.hasOwn(TECHNOLOGY_SORTS, value);
}

/** The table's parsed filter → the query parameters of `GET /api/v1/technologies` (`api-contract.md` §3). */
export function toTechnologyListQuery(filter: TechnologyFilter): TechnologyListQuery {
  const query: TechnologyListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isTechnologyListSort(filter.sort)) query.sort = filter.sort;
  if (filter.category !== undefined) query.category = filter.category;
  // The BE reads the flag as the literal `true` or `false`, not as a boolean.
  if (filter.active !== undefined) query.active = filter.active ? "true" : "false";
  return query;
}
