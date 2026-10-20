"use server";

import {
  accountFilterSchema,
  createAccountInputSchema,
  createMovementInputSchema,
  createTransferInputSchema,
  reconcileAccountInputSchema,
  updateAccountInputSchema,
} from "@/lib/validators/accounts";
import * as accounts from "@/mocks/services/accounts";
import { defineAction } from "@/server/actions/define-action";

// Server Actions of the accounts module (PRD §8.7, HU-15, HU-16). Each one: session → `can()` → Zod parse →
// service → revalidate → `ActionResult`. The UI hiding a button is cosmetic; these checks are the rule.

const LIST_PATHS = ["/accounts", "/accounts/list"];

export const createAccountAction = defineAction({
  permission: { action: "create", resource: "account" },
  input: createAccountInputSchema,
  revalidate: LIST_PATHS,
  handler: (ctx, data) => accounts.createAccount(ctx, data),
});

export const updateAccountAction = defineAction({
  permission: { action: "update", resource: "account" },
  input: updateAccountInputSchema,
  revalidate: (data) => [...LIST_PATHS, `/accounts/${data.id}`],
  handler: (ctx, data) => accounts.updateAccount(ctx, data),
});

export const createTransferAction = defineAction({
  permission: { action: "create", resource: "account" },
  input: createTransferInputSchema,
  revalidate: LIST_PATHS,
  handler: (ctx, data) => accounts.createTransfer(ctx, data),
});

export const createMovementAction = defineAction({
  permission: { action: "create", resource: "account" },
  input: createMovementInputSchema,
  revalidate: (data) => [...LIST_PATHS, `/accounts/${data.accountId}`],
  handler: (ctx, data) => accounts.createMovement(ctx, data),
});

/** The accounts table reloads its rows through this read when the URL query changes (same grant as the page). */
export const listAccountsAction = defineAction({
  permission: { action: "read", resource: "account" },
  input: accountFilterSchema,
  handler: (ctx, data) => accounts.listAccounts(ctx, data),
});

/** Preview of a reconciliation: it stores nothing, so reading it needs only the account read grant. */
export const reconcileAccountAction = defineAction({
  permission: { action: "read", resource: "account" },
  input: reconcileAccountInputSchema,
  handler: (ctx, data) => accounts.reconcileAccount(ctx, data),
});
