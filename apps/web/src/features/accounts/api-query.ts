import type { AccountLedgerQuery, AccountListQuery } from "@/lib/api/types/accounts";
import type { AccountFilter, AccountLedgerQuery as LedgerFilter } from "@/lib/validators/accounts";

/**
 * Accounts table filter → `GET /api/v1/accounts` query (`api-contract.md` §3). A key mapping only: the BE
 * validates the values (a bad sort comes back as `VALIDATION`). `archived` is never sent: accounts are
 * deactivated, never archived (DT-122), and the BE ignores it. `includeInactive` is always explicit, so the
 * pickers (which omit it) and the list (which sends it) read the same way on both sides.
 */
export function toAccountListQuery(filter: AccountFilter): AccountListQuery {
  const query: AccountListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    includeInactive: filter.includeInactive ? "true" : "false",
  };
  if (filter.sort !== undefined) query.sort = filter.sort as NonNullable<AccountListQuery["sort"]>;
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.type !== undefined) query.type = filter.type;
  if (filter.currency !== undefined) query.currency = filter.currency;
  if (filter.status !== undefined) query.status = filter.status;
  return query;
}

/** Ledger filter → `GET /api/v1/accounts/{id}/ledger` query; the account id travels in the path. */
export function toLedgerQuery(filter: LedgerFilter): AccountLedgerQuery {
  const query: AccountLedgerQuery = { page: filter.page, pageSize: filter.pageSize };
  if (filter.sort !== undefined)
    query.sort = filter.sort as NonNullable<AccountLedgerQuery["sort"]>;
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.kind !== undefined) query.kind = filter.kind;
  if (filter.dateFrom !== undefined) query.dateFrom = filter.dateFrom;
  if (filter.dateTo !== undefined) query.dateTo = filter.dateTo;
  return query;
}
