import type { components, operations } from "../schema";

// Generated accounts DTOs re-exported for code outside `src/lib/api/**`, which may not import the schema
// (ESLint). Nothing here is hand-written: each type is a view of the BE OpenAPI document (C8).

/** One account with its balance (`GET|POST /api/v1/accounts`, `GET|PATCH /api/v1/accounts/{id}`). */
export type AccountResponseDto = components["schemas"]["AccountResponseDto"];

/** `GET /api/v1/accounts`: one page of accounts. */
export type AccountListResponseDto = components["schemas"]["AccountListResponseDto"];

/** `GET /api/v1/accounts` query: the flat keys of the list (`api-contract.md` §3). */
export type AccountListQuery = NonNullable<operations["listAccounts"]["parameters"]["query"]>;
export type AccountListSort = NonNullable<AccountListQuery["sort"]>;

/** `GET /api/v1/accounts/overview`. */
export type AccountsOverviewDto = components["schemas"]["AccountsOverviewDto"];

/** `GET /api/v1/accounts/partners`: the partners behind a contribution or withdrawal. */
export type AccountPartnerResponseDto = components["schemas"]["AccountPartnerResponseDto"];

/** `GET /api/v1/accounts/{id}/ledger`: one page of entries with the running balance. */
export type AccountLedgerResponseDto = components["schemas"]["AccountLedgerResponseDto"];
export type AccountLedgerEntryDto = AccountLedgerResponseDto["items"][number];
export type AccountLedgerQuery = NonNullable<operations["getAccountLedger"]["parameters"]["query"]>;
export type AccountLedgerSort = NonNullable<AccountLedgerQuery["sort"]>;

/** `GET /api/v1/accounts/{id}/balance?at`. */
export type AccountBalanceResponseDto = components["schemas"]["AccountBalanceResponseDto"];

/** Request bodies. */
export type CreateAccountDto = components["schemas"]["CreateAccountDto"];
export type UpdateAccountDto = components["schemas"]["UpdateAccountDto"];
export type CreateMovementDto = components["schemas"]["CreateMovementDto"];
export type CreateTransferDto = components["schemas"]["CreateTransferDto"];
export type ReconcileAccountDto = components["schemas"]["ReconcileAccountDto"];

/** Command results. */
export type MovementResponseDto = components["schemas"]["MovementResponseDto"];
export type TransferResponseDto = components["schemas"]["TransferResponseDto"];
export type ReconciliationResponseDto = components["schemas"]["ReconciliationResponseDto"];
