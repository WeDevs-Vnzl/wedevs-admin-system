import "server-only";
import {
  accountFilterSchema,
  accountLedgerQuerySchema,
  type AccountFilterInput,
  type AccountLedgerQuery,
} from "@/lib/validators/accounts";
import { idSchema } from "@/lib/validators/common";
import * as accounts from "@/mocks/services/accounts";
import { getServiceContext } from "@/server/context";

// Reads for the accounts pages (RSC). Each read resolves the session in `getServiceContext` and parses its
// input with the contract schema. Pages call `notFound()` when `getAccount` throws `NOT_FOUND`.

/** Accounts for the list page and the pickers; the facets of `/accounts/list` are optional (S15). */
export async function listAccounts(input: AccountFilterInput = {}) {
  return accounts.listAccounts(await getServiceContext(), accountFilterSchema.parse(input));
}

export async function getAccountsOverview() {
  return accounts.getAccountsOverview(await getServiceContext());
}

export async function getAccount(id: string) {
  return accounts.getAccount(await getServiceContext(), idSchema.parse(id));
}

export async function getAccountLedger(input: AccountLedgerQuery | Record<string, unknown>) {
  return accounts.getAccountLedger(
    await getServiceContext(),
    accountLedgerQuerySchema.parse(input),
  );
}

export async function listAccountPartners() {
  return accounts.listAccountPartners(await getServiceContext());
}
