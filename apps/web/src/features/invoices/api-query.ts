import type { InvoiceListQuery, InvoiceListSort } from "@/lib/api/types/invoices";
import type { InvoiceFilters } from "@/lib/validators/invoices";

/**
 * Sort tokens of `GET /api/v1/invoices`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const INVOICE_SORTS: Record<InvoiceListSort, true> = {
  "code:asc": true,
  "code:desc": true,
  "invoiceNumber:asc": true,
  "invoiceNumber:desc": true,
  "issueDate:asc": true,
  "issueDate:desc": true,
  "dueDate:asc": true,
  "dueDate:desc": true,
  "total:asc": true,
  "total:desc": true,
  "totalUsd:asc": true,
  "totalUsd:desc": true,
  "balance:asc": true,
  "balance:desc": true,
  "balanceUsd:asc": true,
  "balanceUsd:desc": true,
  "status:asc": true,
  "status:desc": true,
  "daysOverdue:asc": true,
  "daysOverdue:desc": true,
};

function isInvoiceListSort(value: string): value is InvoiceListSort {
  return Object.hasOwn(INVOICE_SORTS, value);
}

/**
 * The table's parsed filter → the query parameters of `GET /api/v1/invoices` (`api-contract.md` §3): flat facet
 * keys (`tagId` included), `archived` instead of `includeArchived`. The BE honours `archived` only for the trash
 * roles (choice 9); the FE only hides the toggle.
 */
export function toInvoiceListQuery(filter: InvoiceFilters): InvoiceListQuery {
  const query: InvoiceListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isInvoiceListSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.clientId !== undefined) query.clientId = filter.clientId;
  if (filter.projectId !== undefined) query.projectId = filter.projectId;
  if (filter.currency !== undefined) query.currency = filter.currency;
  if (filter.tagId !== undefined) query.tagId = filter.tagId;
  if (filter.dateFrom !== undefined) query.dateFrom = filter.dateFrom;
  if (filter.dateTo !== undefined) query.dateTo = filter.dateTo;
  return query;
}
