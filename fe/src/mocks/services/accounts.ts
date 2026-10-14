// MOCK — account services of H1-B3 (PRD §8.7, §9.7, §12 `accounts`). `fn(ctx, input)`, framework-free (C11).
// Replaced by `src/server/services/accounts.service.ts` in Hito 2 (C9).
// Balances are never computed here: the derive pass of the store fills `balance` and `balanceUsd` through
// `lib/finance` (C17). The ledger takes its running balances from `accountLedger`; the rows only add the
// identity of each entry, which the lib does not return. USD snapshots of transfers and movements are stored
// at write time and never recomputed (§9).
import { diffFields } from "@/lib/activity-diff";
import type { DateOnly } from "@/lib/dates";
import {
  accountBalance,
  accountLedger,
  reconciliationAdjustment,
  transferProblem,
  type AccountActivity,
  type LedgerKind,
} from "@/lib/finance";
import { roundMoney, sumMoney, toUsd, type MoneyString } from "@/lib/money";
import {
  ACCOUNT_MESSAGES,
  type AccountDTO,
  type AccountLedgerQuery,
  type AccountsOverviewDTO,
  type AccountStatusFilter,
  type CreateAccountInput,
  type CreateMovementInput,
  type CreateTransferInput,
  type LedgerEntryKind,
  type LedgerRow,
  type MovementDTO,
  type ReconcileAccountInput,
  type TransferDTO,
  type UpdateAccountInput,
} from "@/lib/validators/accounts";
import type { AccountType } from "@/lib/validators/enums";
import type { ActivityChanges } from "@/lib/validators/activity";
import { DEFAULT_PAGE_SIZE, type EntityRef, type Paginated } from "@/lib/validators/common";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockId } from "../ids";
import { deriveMockStore, type MockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

/** Ledger entries are read up to this date so every row carries its running balance (the sum is a prefix). */
const LEDGER_END: DateOnly = "9999-12-31";

/** Messages this module adds to `ACCOUNT_MESSAGES` (keys of `accounts.json`). */
const MESSAGES = {
  inactive: "accounts.validation.inactive",
  currencyLocked: "accounts.validation.currencyLocked",
} as const;

/**
 * Input of `listAccounts`: the table query, the inactive accounts (hidden by default) and the optional facets
 * of `/accounts/list`. `status` wins over `includeInactive` when present.
 */
export type AccountListInput = {
  q?: string | undefined;
  page?: number | undefined;
  pageSize?: 25 | 50 | 100 | undefined;
  sort?: string | undefined;
  includeInactive?: boolean | undefined;
  type?: AccountType[] | undefined;
  currency?: string[] | undefined;
  status?: AccountStatusFilter[] | undefined;
};

/** Result of a reconciliation: the balance the statement shows against the system balance (HU-15 CA3). */
export type ReconciliationPreview = {
  accountId: string;
  date: DateOnly;
  statementBalance: MoneyString;
  systemBalance: MoneyString;
  /** `statementBalance − systemBalance`; `"0.00"` when they match. */
  difference: MoneyString;
  /** Signed `AJUSTE` that closes the difference; `null` when there is none. */
  suggestedAdjustment: MoneyString | null;
};

/** A user who can be the partner behind a contribution or withdrawal. */
export type AccountPartnerDTO = { id: string; name: string };

const orNull = <T>(value: T | undefined): T | null => value ?? null;

function findAccount(db: MockStore, id: string): AccountDTO {
  const row = db.accounts.find((account) => account.id === id);
  if (!row) throw new ServiceError("NOT_FOUND");
  return row;
}

function refOf(type: EntityRef["type"], id: string, label: string): EntityRef {
  return { id, label, type };
}

// ───────────────────────────── Activity and ledger (C17) ─────────────────────────────

/** One entry of the ledger before it is turned into a row: its identity and the text it shows. */
type LedgerSource = {
  key: string;
  kind: LedgerEntryKind;
  date: DateOnly;
  source: EntityRef | null;
  description: string | null;
};

/**
 * The inputs `lib/finance` needs for one account, and the same entries as identified sources. Both are read
 * from the same filtered collections, so they cannot disagree. The status filters repeat the ones of the
 * lib, which decides what changes the balance; the sources only add identity.
 */
function collectAccount(db: MockStore, account: AccountDTO) {
  const payments = db.payments.filter((payment) => payment.account.id === account.id);
  const expenses = db.expenses.filter((expense) => expense.account?.id === account.id);
  const transfersIn = db.transfers.filter((transfer) => transfer.toAccount.id === account.id);
  const transfersOut = db.transfers.filter((transfer) => transfer.fromAccount.id === account.id);
  const movements = db.movements.filter((movement) => movement.account.id === account.id);

  const activity: AccountActivity = {
    openingBalance: account.openingBalance,
    payments: payments.map((payment) => ({
      date: payment.date,
      netCredited: payment.netCredited,
      status: payment.status,
    })),
    expenses: expenses.map((expense) => ({
      date: expense.paidAt ?? expense.date,
      amount: expense.amount,
      accountAmount: expense.accountAmount,
      status: expense.status,
    })),
    transfersIn: transfersIn.map((transfer) => ({
      date: transfer.date,
      amountTo: transfer.amountTo,
    })),
    transfersOut: transfersOut.map((transfer) => ({
      date: transfer.date,
      amountFrom: transfer.amountFrom,
      feeAmount: transfer.feeAmount,
    })),
    movements: movements.map((movement) => ({
      date: movement.date,
      type: movement.type,
      amount: movement.amount,
    })),
  };

  const byDate = (a: LedgerSource, b: LedgerSource) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  const queues: Record<LedgerKind, LedgerSource[]> = {
    PAYMENT: payments
      .filter((payment) => payment.status === "CONFIRMADO")
      .map((payment) => ({
        key: `payment:${payment.id}`,
        kind: "PAYMENT" as const,
        date: payment.date,
        source: refOf("PAYMENT", payment.id, payment.code),
        description: payment.reference,
      })),
    EXPENSE: expenses
      .filter((expense) => expense.status === "PAGADO")
      .map((expense) => ({
        key: `expense:${expense.id}`,
        kind: "EXPENSE" as const,
        date: expense.paidAt ?? expense.date,
        source: refOf("EXPENSE", expense.id, expense.code),
        description: expense.description,
      })),
    TRANSFER_IN: transfersIn.map((transfer) => ({
      key: `transfer-in:${transfer.id}`,
      kind: "TRANSFER_IN" as const,
      date: transfer.date,
      source: refOf("TRANSFER", transfer.id, transfer.reference ?? transfer.id),
      description: transfer.notes,
    })),
    TRANSFER_OUT: transfersOut.map((transfer) => ({
      key: `transfer-out:${transfer.id}`,
      kind: "TRANSFER_OUT" as const,
      date: transfer.date,
      source: refOf("TRANSFER", transfer.id, transfer.reference ?? transfer.id),
      description: transfer.notes,
    })),
    MOVEMENT: movements.map((movement) => ({
      key: `movement:${movement.id}`,
      kind: movement.type,
      date: movement.date,
      source: refOf("ACCOUNT_MOVEMENT", movement.id, movement.description),
      description: movement.description,
    })),
  };
  for (const queue of Object.values(queues)) queue.sort(byDate);
  return { activity, queues };
}

/** Every balance-changing entry of the account, in ledger order, with its running balance (HU-15 CA2). */
function buildLedger(db: MockStore, account: AccountDTO): LedgerRow[] {
  const { activity, queues } = collectAccount(db, account);
  const cursor: Record<LedgerKind, number> = {
    PAYMENT: 0,
    EXPENSE: 0,
    TRANSFER_IN: 0,
    TRANSFER_OUT: 0,
    MOVEMENT: 0,
  };
  const rows: LedgerRow[] = [
    {
      id: `opening:${account.id}`,
      date: account.openingDate,
      kind: "OPENING_BALANCE",
      source: null,
      description: null,
      amount: roundMoney(account.openingBalance),
      balance: roundMoney(account.openingBalance),
    },
  ];
  for (const entry of accountLedger(activity, LEDGER_END)) {
    const source = queues[entry.kind][cursor[entry.kind]];
    cursor[entry.kind] += 1;
    // The lib emits each kind in the order of its sorted sources; a mismatch is a broken invariant.
    if (!source || source.date !== entry.date) {
      throw new Error(`Ledger of ${account.id} does not match its sources`);
    }
    rows.push({
      id: source.key,
      date: entry.date,
      kind: source.kind,
      source: source.source,
      description: source.description,
      amount: entry.delta,
      balance: entry.balance,
    });
  }
  return rows;
}

// ───────────────────────────── Accounts ─────────────────────────────

const accountSpec: ListSpec<AccountDTO> = {
  searchText: (row) => [row.name, row.institution, row.currency, row.holderName],
  sorters: {
    name: (row) => row.name,
    type: (row) => row.type,
    institution: (row) => row.institution,
    currency: (row) => row.currency,
    balance: (row) => Number(row.balance),
    balanceUsd: (row) => (row.balanceUsd === null ? null : Number(row.balanceUsd)),
    active: (row) => row.active,
    status: (row) => row.active,
  },
  defaultSort: "name:asc",
};

/** Accounts for the list and the pickers; inactive ones only with `includeInactive` (or a `status` facet). */
export async function listAccounts(
  ctx: MockServiceContext,
  input: AccountListInput,
): Promise<Paginated<AccountDTO>> {
  const statuses = input.status?.length ? input.status : undefined;
  const rows = ctx.db.accounts
    .filter((account) =>
      statuses
        ? statuses.includes(account.active ? "active" : "inactive")
        : input.includeInactive || account.active,
    )
    .filter((account) => !input.type?.length || input.type.includes(account.type))
    .filter((account) => !input.currency?.length || input.currency.includes(account.currency))
    .map((account) => structuredClone(account));
  return listRows(
    rows,
    {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? DEFAULT_PAGE_SIZE,
      sort: input.sort,
      q: input.q,
    },
    accountSpec,
  );
}

/**
 * `/accounts` overview (DT-25): a card per account, and the consolidated USD total of the active accounts.
 * An account without a rate for its currency adds nothing to the total (it has no `balanceUsd`).
 */
export async function getAccountsOverview(ctx: MockServiceContext): Promise<AccountsOverviewDTO> {
  const accounts = ctx.db.accounts.map((account) => structuredClone(account));
  const usd = accounts
    .filter((account) => account.active && account.balanceUsd !== null)
    .map((account) => account.balanceUsd as MoneyString);
  return { accounts, totalBalanceUsd: sumMoney(usd) };
}

export async function getAccount(ctx: MockServiceContext, id: string): Promise<AccountDTO> {
  return structuredClone(findAccount(ctx.db, id));
}

/** Users who can be a partner of a contribution or withdrawal (PRD §8.7). */
export async function listAccountPartners(ctx: MockServiceContext): Promise<AccountPartnerDTO[]> {
  return ctx.db.users.map((user) => ({ id: user.id, name: user.name }));
}

export async function createAccount(
  ctx: MockServiceContext,
  input: CreateAccountInput,
): Promise<AccountDTO> {
  const now = ctx.now.toISOString();
  const row: AccountDTO = {
    id: nextMockId(ctx.db.idCounters, "acc", (id) =>
      ctx.db.accounts.some((item) => item.id === id),
    ),
    name: input.name,
    type: input.type,
    institution: orNull(input.institution),
    currency: input.currency,
    identifierMasked: orNull(input.identifierMasked),
    holderName: orNull(input.holderName),
    openingBalance: roundMoney(input.openingBalance),
    openingDate: input.openingDate,
    active: input.active,
    notes: orNull(input.notes),
    balance: "0.00",
    balanceUsd: null,
    createdAt: now,
    updatedAt: now,
  };
  ctx.db.accounts.push(row);
  deriveMockStore(ctx.db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "ACCOUNT",
    entityId: row.id,
    entityLabel: row.name,
  });
  return structuredClone(row);
}

/** Edits an account. The currency is fixed once the account has movements (its balance is in that currency). */
export async function updateAccount(
  ctx: MockServiceContext,
  input: UpdateAccountInput,
): Promise<AccountDTO> {
  const row = findAccount(ctx.db, input.id);
  const hasMovements =
    ctx.db.payments.some((payment) => payment.account.id === row.id) ||
    ctx.db.expenses.some((expense) => expense.account?.id === row.id) ||
    ctx.db.transfers.some(
      (transfer) => transfer.fromAccount.id === row.id || transfer.toAccount.id === row.id,
    ) ||
    ctx.db.movements.some((movement) => movement.account.id === row.id);
  if (hasMovements && input.currency !== row.currency) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { currency: [MESSAGES.currencyLocked] },
    });
  }
  const before = { ...row };
  Object.assign(row, {
    name: input.name,
    type: input.type,
    institution: orNull(input.institution),
    currency: input.currency,
    // A blank identifier keeps the stored one (undefined); an explicit null clears it.
    identifierMasked:
      input.identifierMasked === undefined ? row.identifierMasked : input.identifierMasked,
    holderName: orNull(input.holderName),
    openingBalance: roundMoney(input.openingBalance),
    openingDate: input.openingDate,
    active: input.active,
    notes: orNull(input.notes),
    updatedAt: ctx.now.toISOString(),
  });
  deriveMockStore(ctx.db);
  const changes: ActivityChanges | undefined = diffFields(before, row, {
    fields: [
      "name",
      "type",
      "institution",
      "currency",
      "identifierMasked",
      "holderName",
      "openingBalance",
      "openingDate",
      "active",
      "notes",
    ],
  });
  if (changes) {
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "ACCOUNT",
      entityId: row.id,
      entityLabel: row.name,
      changes,
    });
  }
  return structuredClone(row);
}

// ───────────────────────────── Ledger, reconciliation ─────────────────────────────

const ledgerSpec: ListSpec<LedgerRow> = {
  searchText: (row) => [row.description, row.source?.label],
  sorters: {
    date: (row) => row.date,
    kind: (row) => row.kind,
    amount: (row) => row.amount,
    balance: (row) => row.balance,
  },
  defaultSort: "date:asc",
};

/** The account ledger with running balances; the filters narrow the rows, never the balance they show. */
export async function getAccountLedger(
  ctx: MockServiceContext,
  query: AccountLedgerQuery,
): Promise<Paginated<LedgerRow>> {
  const account = findAccount(ctx.db, query.accountId);
  const rows = buildLedger(ctx.db, account)
    .filter((row) => !query.kind || query.kind.includes(row.kind))
    .filter((row) => !query.dateFrom || row.date >= query.dateFrom)
    .filter((row) => !query.dateTo || row.date <= query.dateTo);
  return listRows(rows, query, ledgerSpec);
}

/**
 * Reconciliation (HU-15 CA3): compares the statement balance with the system balance at `date` and suggests the
 * `AJUSTE` for the difference. Nothing is stored: the screen records the adjustment through `createMovement`.
 */
export async function reconcileAccount(
  ctx: MockServiceContext,
  input: ReconcileAccountInput,
): Promise<ReconciliationPreview> {
  const account = findAccount(ctx.db, input.accountId);
  const { activity } = collectAccount(ctx.db, account);
  const systemBalance = accountBalance(activity, input.date);
  const suggestedAdjustment = reconciliationAdjustment(systemBalance, input.statementBalance);
  return {
    accountId: account.id,
    date: input.date,
    statementBalance: roundMoney(input.statementBalance),
    systemBalance,
    difference: suggestedAdjustment ?? "0.00",
    suggestedAdjustment,
  };
}

// ───────────────────────────── Transfers (HU-16) ─────────────────────────────

/**
 * Transfer between two accounts (HU-16 CA1): debits `amountFrom` plus the fee from the origin and credits
 * `amountTo` (already in the destination currency) to the destination. HU-16 CA2: an account cannot transfer
 * to itself.
 */
export async function createTransfer(
  ctx: MockServiceContext,
  input: CreateTransferInput,
): Promise<TransferDTO> {
  if (transferProblem(input.fromAccountId, input.toAccountId)) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { toAccountId: [ACCOUNT_MESSAGES.sameAccount] },
    });
  }
  const from = findAccount(ctx.db, input.fromAccountId);
  const to = findAccount(ctx.db, input.toAccountId);
  if (!from.active) {
    throw new ServiceError("VALIDATION", { fieldErrors: { fromAccountId: [MESSAGES.inactive] } });
  }
  if (!to.active) {
    throw new ServiceError("VALIDATION", { fieldErrors: { toAccountId: [MESSAGES.inactive] } });
  }
  const row: TransferDTO = {
    id: nextMockId(ctx.db.idCounters, "trf", (id) =>
      ctx.db.transfers.some((item) => item.id === id),
    ),
    date: input.date,
    fromAccount: refOf("ACCOUNT", from.id, from.name),
    toAccount: refOf("ACCOUNT", to.id, to.name),
    amountFrom: roundMoney(input.amountFrom),
    amountTo: roundMoney(input.amountTo),
    feeAmount: roundMoney(input.feeAmount),
    rate: orNull(input.rate),
    // Snapshot at write time with the origin-currency rate of the day (§9); never recomputed.
    amountUsd: toUsd(roundMoney(input.amountFrom), input.usdRate),
    reference: orNull(input.reference),
    notes: orNull(input.notes),
    createdAt: ctx.now.toISOString(),
  };
  ctx.db.transfers.push(row);
  deriveMockStore(ctx.db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "TRANSFER",
    entityId: row.id,
    entityLabel: `${from.name} → ${to.name}`,
  });
  return structuredClone(row);
}

// ───────────────────────────── Manual movements ─────────────────────────────

/**
 * Manual movement: a contribution, a withdrawal (positive amounts, the balance applies the sign) or a signed
 * `AJUSTE`. Contributions and withdrawals name the partner behind them.
 */
export async function createMovement(
  ctx: MockServiceContext,
  input: CreateMovementInput,
): Promise<MovementDTO> {
  const account = findAccount(ctx.db, input.accountId);
  if (!account.active) {
    throw new ServiceError("VALIDATION", { fieldErrors: { accountId: [MESSAGES.inactive] } });
  }
  let partner: EntityRef | null = null;
  if (input.type !== "AJUSTE") {
    const user = ctx.db.users.find((item) => item.id === input.partnerId);
    if (!user) {
      throw new ServiceError("VALIDATION", {
        fieldErrors: { partnerId: [ACCOUNT_MESSAGES.partnerRequired] },
      });
    }
    partner = refOf("USER", user.id, user.name);
  }
  const amount = roundMoney(input.amount);
  const row: MovementDTO = {
    id: nextMockId(ctx.db.idCounters, "mov", (id) =>
      ctx.db.movements.some((item) => item.id === id),
    ),
    account: refOf("ACCOUNT", account.id, account.name),
    type: input.type,
    date: input.date,
    amount,
    amountUsd: toUsd(amount, input.usdRate),
    partner,
    description: input.description,
    createdAt: ctx.now.toISOString(),
  };
  ctx.db.movements.push(row);
  deriveMockStore(ctx.db);
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "ACCOUNT_MOVEMENT",
    entityId: row.id,
    entityLabel: account.name,
  });
  return structuredClone(row);
}
