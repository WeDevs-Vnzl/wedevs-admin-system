import type { PaymentListQuery, PaymentListSort } from "@/lib/api/types/payments";
import type { PaymentFilters } from "@/lib/validators/payments";

/**
 * Sort tokens of `GET /api/v1/payments`. The record is exhaustive over the generated union, so a contract change
 * that adds or removes a token fails `tsc` here (C8).
 */
const PAYMENT_SORTS: Record<PaymentListSort, true> = {
  "code:asc": true,
  "code:desc": true,
  "date:asc": true,
  "date:desc": true,
  "amount:asc": true,
  "amount:desc": true,
  "amountUsd:asc": true,
  "amountUsd:desc": true,
  "allocated:asc": true,
  "allocated:desc": true,
  "unallocated:asc": true,
  "unallocated:desc": true,
  "reference:asc": true,
  "reference:desc": true,
  "status:asc": true,
  "status:desc": true,
};

const isPaymentSort = (value: string): value is PaymentListSort =>
  Object.hasOwn(PAYMENT_SORTS, value);

/**
 * The table's parsed filter → the query of `GET /api/v1/payments` (`api-contract.md` §3): flat facet keys, lists as
 * repeated keys. Payments do not archive (DT-122), so `archived` is never sent; the BE validates every value.
 */
export function toPaymentListQuery(filter: PaymentFilters): PaymentListQuery {
  const query: PaymentListQuery = { page: filter.page, pageSize: filter.pageSize };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isPaymentSort(filter.sort)) query.sort = filter.sort;
  if (filter.status !== undefined) query.status = filter.status;
  if (filter.clientId !== undefined) query.clientId = filter.clientId;
  if (filter.accountId !== undefined) query.accountId = filter.accountId;
  if (filter.methodId !== undefined) query.methodId = filter.methodId;
  if (filter.currency !== undefined) query.currency = filter.currency;
  if (filter.dateFrom !== undefined) query.dateFrom = filter.dateFrom;
  if (filter.dateTo !== undefined) query.dateTo = filter.dateTo;
  if (filter.hasUnallocated !== undefined) {
    query.hasUnallocated = filter.hasUnallocated ? "true" : "false";
  }
  return query;
}
