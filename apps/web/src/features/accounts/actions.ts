"use server";

import { apiAction } from "@/lib/api/action";
import type {
  AccountListResponseDto,
  AccountResponseDto,
  CreateAccountDto,
  CreateMovementDto,
  CreateTransferDto,
  MovementResponseDto,
  ReconcileAccountDto,
  ReconciliationResponseDto,
  TransferResponseDto,
  UpdateAccountDto,
} from "@/lib/api/types/accounts";
import { accountFilterSchema, type AccountFilterInput } from "@/lib/validators/accounts";
import { errorMessageKey, type ActionResult } from "@/lib/validators/common";
import { toAccountListQuery } from "./api-query";

// Thin API proxies (C10, PRD §8.7, HU-15, HU-16): token → one BE call → error mapping → revalidate. The BE
// decides every grant, every money rule and every balance; the FE never checks `can()` or computes an amount
// here. Amounts travel as decimal strings (C15).

const LIST_PATHS = ["/accounts", "/accounts/list"];

// The forms validate for UX and hand over the parsed values; the commands take the BE's own body types (C8),
// plus the account id the path needs.
type UpdateAccountInput = UpdateAccountDto & { id: string };
type CreateMovementInput = CreateMovementDto & { accountId: string };
type ReconcileAccountInput = ReconcileAccountDto & { accountId: string };

export const createAccountAction = apiAction<CreateAccountDto, AccountResponseDto>({
  call: (input, api) => api.POST("/api/v1/accounts", { body: input }),
  revalidate: LIST_PATHS,
});

/** An account is deactivated, never archived (DT-122); the BE answers `INTEGRITY_LOCK` for a locked change. */
export const updateAccountAction = apiAction<UpdateAccountInput, AccountResponseDto>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/accounts/{id}", { params: { path: { id } }, body }),
  revalidate: (input) => [...LIST_PATHS, `/accounts/${input.id}`],
});

export const createTransferAction = apiAction<CreateTransferDto, TransferResponseDto>({
  call: (input, api) => api.POST("/api/v1/transfers", { body: input }),
  revalidate: (input) => [
    ...LIST_PATHS,
    `/accounts/${input.fromAccountId}`,
    `/accounts/${input.toAccountId}`,
  ],
});

export const createMovementAction = apiAction<CreateMovementInput, MovementResponseDto>({
  call: ({ accountId, ...body }, api) =>
    api.POST("/api/v1/accounts/{id}/movements", { params: { path: { id: accountId } }, body }),
  revalidate: (input) => [...LIST_PATHS, `/accounts/${input.accountId}`],
});

/**
 * Reconciliation (DT-123): the BE stores the row and answers the system balance, the difference and the
 * `suggestedAdjustment`. The `AJUSTE` stays a separate movement, recorded through the movement form.
 */
export const reconcileAccountAction = apiAction<ReconcileAccountInput, ReconciliationResponseDto>({
  call: ({ accountId, ...body }, api) =>
    api.POST("/api/v1/accounts/{id}/reconcile", { params: { path: { id: accountId } }, body }),
  revalidate: (input) => [`/accounts/${input.accountId}`],
});

const listAccounts = apiAction<AccountFilterInput, AccountListResponseDto>({
  call: (input, api) =>
    api.GET("/api/v1/accounts", {
      params: { query: toAccountListQuery(accountFilterSchema.parse(input)) },
    }),
});

/**
 * The accounts table reloads its rows through this read when the URL query changes. The filter is checked for UX
 * only (a bad sort never leaves the FE); the BE re-validates and decides who may read.
 */
export async function listAccountsAction(
  input: AccountFilterInput,
): Promise<ActionResult<AccountListResponseDto>> {
  if (!accountFilterSchema.safeParse(input).success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listAccounts(input);
}
