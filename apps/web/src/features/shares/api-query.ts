import type {
  ShareAccessLogQuery,
  ShareAccessLogSort,
  ShareListQuery,
  ShareListSort,
} from "@/lib/api/types/shares";
import type { ShareAccessLogFilter, ShareFilter } from "@/lib/validators/shares";

/**
 * Sort tokens of the share routes. The records are exhaustive over the generated unions, so a contract change that
 * adds or removes a token fails `tsc` here (C8).
 */
const SHARE_SORTS: Record<ShareListSort, true> = {
  "title:asc": true,
  "title:desc": true,
  "status:asc": true,
  "status:desc": true,
  "expiresAt:asc": true,
  "expiresAt:desc": true,
  "viewCount:asc": true,
  "viewCount:desc": true,
  "downloadCount:asc": true,
  "downloadCount:desc": true,
  "lastAccessedAt:asc": true,
  "lastAccessedAt:desc": true,
  "createdAt:asc": true,
  "createdAt:desc": true,
};
const ACCESS_LOG_SORTS: Record<ShareAccessLogSort, true> = {
  "createdAt:asc": true,
  "createdAt:desc": true,
  "event:asc": true,
  "event:desc": true,
};

function isShareSort(value: string): value is ShareListSort {
  return Object.hasOwn(SHARE_SORTS, value);
}
function isAccessLogSort(value: string): value is ShareAccessLogSort {
  return Object.hasOwn(ACCESS_LOG_SORTS, value);
}

/** The table's or tab's parsed filter → the query parameters of `GET /api/v1/share-links` (`api-contract.md` §3). */
export function toShareListQuery(filter: ShareFilter): ShareListQuery {
  const query: ShareListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isShareSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.clientId !== undefined) query.clientId = filter.clientId;
  if (filter.documentId !== undefined) query.documentId = filter.documentId;
  if (filter.hasAccessKeys !== undefined) {
    query.hasAccessKeys = filter.hasAccessKeys === true ? "true" : "false";
  }
  if (filter.createdFrom !== undefined) query.createdFrom = filter.createdFrom;
  if (filter.createdTo !== undefined) query.createdTo = filter.createdTo;
  return query;
}

/** The access table's parsed filter → the query parameters of `GET /api/v1/share-links/{id}/access-log`. */
export function toAccessLogQuery(filter: ShareAccessLogFilter): ShareAccessLogQuery {
  const query: ShareAccessLogQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isAccessLogSort(filter.sort)) query.sort = filter.sort;
  if (filter.event !== undefined) query.event = filter.event;
  if (filter.documentId !== undefined) query.documentId = filter.documentId;
  if (filter.from !== undefined) query.from = filter.from;
  if (filter.to !== undefined) query.to = filter.to;
  return query;
}
