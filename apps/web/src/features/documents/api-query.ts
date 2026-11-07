import type { DocumentListQuery, DocumentListSort } from "@/lib/api/types/documents";
import type { DocumentFilter } from "@/lib/validators/documents";

/**
 * Sort tokens of `GET /api/v1/documents`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const DOCUMENT_SORTS: Record<DocumentListSort, true> = {
  "code:asc": true,
  "code:desc": true,
  "title:asc": true,
  "title:desc": true,
  "category:asc": true,
  "category:desc": true,
  "type:asc": true,
  "type:desc": true,
  "status:asc": true,
  "status:desc": true,
  "format:asc": true,
  "format:desc": true,
  "versionNumber:asc": true,
  "versionNumber:desc": true,
  "expiresAt:asc": true,
  "expiresAt:desc": true,
  "updatedAt:asc": true,
  "updatedAt:desc": true,
  "createdAt:asc": true,
  "createdAt:desc": true,
};

function isDocumentListSort(value: string): value is DocumentListSort {
  return Object.hasOwn(DOCUMENT_SORTS, value);
}

/**
 * The table's parsed filter → the query parameters of `GET /api/v1/documents` (`api-contract.md` §3): flat facet
 * keys (one per link type, HU-20 CA1), `archived` instead of `includeArchived`. The BE refuses `archived` for roles
 * without the trash grant; the FE only hides the toggle.
 */
export function toDocumentListQuery(filter: DocumentFilter): DocumentListQuery {
  const query: DocumentListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isDocumentListSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.categoryId !== undefined) query.categoryId = filter.categoryId;
  if (filter.typeId !== undefined) query.typeId = filter.typeId;
  if (filter.format !== undefined) query.format = filter.format;
  if (filter.clientId !== undefined) query.clientId = filter.clientId;
  if (filter.contactId !== undefined) query.contactId = filter.contactId;
  if (filter.projectId !== undefined) query.projectId = filter.projectId;
  if (filter.invoiceId !== undefined) query.invoiceId = filter.invoiceId;
  if (filter.paymentId !== undefined) query.paymentId = filter.paymentId;
  if (filter.expenseId !== undefined) query.expenseId = filter.expenseId;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  if (filter.expiresFrom !== undefined) query.expiresFrom = filter.expiresFrom;
  if (filter.expiresTo !== undefined) query.expiresTo = filter.expiresTo;
  if (filter.expiringWithinDays !== undefined) {
    query.expiringWithinDays = String(filter.expiringWithinDays);
  }
  if (filter.shared !== undefined) query.shared = filter.shared ? "true" : "false";
  if (filter.staleDraft !== undefined) query.staleDraft = filter.staleDraft ? "true" : "false";
  return query;
}
