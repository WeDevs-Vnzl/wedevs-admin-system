import type { TrashListQuery } from "@/lib/api/types/trash";
import type { TrashFilterInput } from "@/lib/validators/trash";

/** A facet value arrives as one value or a list (`facetOf`); the API takes a list. */
function asList<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/**
 * Trash table filter → `GET /api/v1/trash` query (`api-contract.md` §3). A key mapping only: the BE validates
 * the values (a bad sort or date comes back as `VALIDATION`). `archived` is never sent, because the trash
 * lists archived rows only.
 */
export function toTrashListQuery(filter: TrashFilterInput): TrashListQuery {
  const query: TrashListQuery = {};
  if (filter.page !== undefined) query.page = Number(filter.page);
  if (filter.pageSize !== undefined) {
    query.pageSize = Number(filter.pageSize) as NonNullable<TrashListQuery["pageSize"]>;
  }
  if (filter.sort !== undefined) query.sort = filter.sort as NonNullable<TrashListQuery["sort"]>;
  if (filter.q !== undefined) query.q = filter.q;
  const entityType = asList(filter.entityType);
  if (entityType !== undefined) query.entityType = entityType;
  const deletedById = asList(filter.deletedById);
  if (deletedById !== undefined) query.deletedById = deletedById;
  if (filter.deletedFrom !== undefined) query.deletedFrom = filter.deletedFrom;
  if (filter.deletedTo !== undefined) query.deletedTo = filter.deletedTo;
  return query;
}
