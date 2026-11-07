import "server-only";
import { toActionResult, type ApiResponseLike } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import {
  accountFilterSchema,
  accountLedgerQuerySchema,
  type AccountFilterInput,
  type AccountLedgerQuery,
} from "@/lib/validators/accounts";
import { idSchema } from "@/lib/validators/common";
import { ServiceError } from "@/lib/service-error";
import { toAccountListQuery, toLedgerQuery } from "./api-query";

// Reads for the accounts pages (RSC) over the generated client. A refused read throws `ServiceError` with the
// BE's code (`404` → NOT_FOUND, `403` → FORBIDDEN, `422` → VALIDATION), the contract the pages and the
// cross-module consumers catch.

/** Unwraps a read or throws the BE's code as a `ServiceError`. */
function unwrap<T>(response: ApiResponseLike<T>): T {
  const result = toActionResult(response);
  if (result.ok) return result.data;
  throw new ServiceError(result.error.code, {
    message: result.error.message,
    ...(result.error.fieldErrors ? { fieldErrors: result.error.fieldErrors } : {}),
  });
}

/** Accounts for the list page and the pickers; the facets of `/accounts/list` are optional (S15). */
export async function listAccounts(input: AccountFilterInput = {}) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/accounts", {
      params: { query: toAccountListQuery(accountFilterSchema.parse(input)) },
    }),
  );
}

/** `GET /api/v1/accounts/overview`: a card per account and the consolidated USD total (`FORBIDDEN` without read). */
export async function getAccountsOverview() {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/accounts/overview"));
}

export async function getAccount(id: string) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/accounts/{id}", { params: { path: { id: idSchema.parse(id) } } }),
  );
}

/** One ledger page with the running balance as the BE computed it (HU-15 CA2). */
export async function getAccountLedger(input: AccountLedgerQuery | Record<string, unknown>) {
  const filter = accountLedgerQuerySchema.parse(input);
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/accounts/{id}/ledger", {
      params: { path: { id: filter.accountId }, query: toLedgerQuery(filter) },
    }),
  );
}

/** Partners behind a contribution or withdrawal (`GET /api/v1/accounts/partners`). */
export async function listAccountPartners() {
  const api = await getServerApi();
  return unwrap(await api.GET("/api/v1/accounts/partners"));
}

/**
 * The Binance snapshot of a wallet account (`GET /api/v1/accounts/{id}/exchange-snapshot`, 6.4). `snapshot` is
 * `null` while the integration is off (DT-193); amounts are returned as strings and never computed here.
 */
export async function getAccountExchangeSnapshot(id: string) {
  const api = await getServerApi();
  return unwrap(
    await api.GET("/api/v1/accounts/{id}/exchange-snapshot", {
      params: { path: { id: idSchema.parse(id) } },
    }),
  );
}
