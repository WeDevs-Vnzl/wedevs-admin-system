import type { TagListQuery, TagListSort } from "@/lib/api/types/taxonomy";
import type { TagFilter } from "@/lib/validators/tags";

/**
 * Sort tokens of `GET /api/v1/tags`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const TAG_SORTS: Record<TagListSort, true> = {
  "name:asc": true,
  "name:desc": true,
  "usageCount:asc": true,
  "usageCount:desc": true,
  "createdAt:asc": true,
  "createdAt:desc": true,
};

function isTagListSort(value: string): value is TagListSort {
  return Object.hasOwn(TAG_SORTS, value);
}

/** The table's parsed filter → the query parameters of `GET /api/v1/tags` (`api-contract.md` §3). */
export function toTagListQuery(filter: TagFilter): TagListQuery {
  const query: TagListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isTagListSort(filter.sort)) query.sort = filter.sort;
  if (filter.entityType !== undefined) query.entityType = filter.entityType;
  return query;
}
