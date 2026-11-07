import type { ClientListQuery, ClientListSort } from "@/lib/api/types/clients";
import type { ClientFilter } from "@/lib/validators/clients";

/**
 * Sort tokens of `GET /api/v1/clients`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const CLIENT_SORTS: Record<ClientListSort, true> = {
  "code:asc": true,
  "code:desc": true,
  "tradeName:asc": true,
  "tradeName:desc": true,
  "kind:asc": true,
  "kind:desc": true,
  "country:asc": true,
  "country:desc": true,
  "status:asc": true,
  "status:desc": true,
  "projectCount:asc": true,
  "projectCount:desc": true,
  "totalInvoicedUsd:asc": true,
  "totalInvoicedUsd:desc": true,
  "receivableUsd:asc": true,
  "receivableUsd:desc": true,
  "lastActivityAt:asc": true,
  "lastActivityAt:desc": true,
  "createdAt:asc": true,
  "createdAt:desc": true,
};

function isClientListSort(value: string): value is ClientListSort {
  return Object.hasOwn(CLIENT_SORTS, value);
}

/**
 * The table's parsed filter → the query parameters of `GET /api/v1/clients` (`api-contract.md` §3): flat facet
 * keys, `archived` instead of `includeArchived`. Money sorts and `hasOverdue` are sent as asked: the BE refuses
 * them for roles without the financial grant (the FE only hides the controls).
 */
export function toClientListQuery(filter: ClientFilter): ClientListQuery {
  const query: ClientListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isClientListSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.kind !== undefined) query.kind = filter.kind;
  if (filter.country !== undefined) query.country = filter.country;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  if (filter.createdFrom !== undefined) query.createdFrom = filter.createdFrom;
  if (filter.createdTo !== undefined) query.createdTo = filter.createdTo;
  if (filter.hasOverdue !== undefined) query.hasOverdue = filter.hasOverdue ? "true" : "false";
  return query;
}
