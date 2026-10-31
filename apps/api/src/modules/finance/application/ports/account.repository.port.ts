import type { DateOnly } from '../../../../shared/domain/business-date';
import type { AccountMovementType, AccountType, EntityType } from '../../../../shared/domain/enums';
import type { SortSpec } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { MoneyString } from '../../../../shared/domain/money';

export const ACCOUNT_REPOSITORY = Symbol('ACCOUNT_REPOSITORY');

/** An account as stored. `balance` is the cache the finance projector rewrites (§9.7, data-rules §3b). */
export interface AccountRecord {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly institution: string | null;
  readonly currency: string;
  /** Always masked (C5): the full identifier is never stored. */
  readonly identifierMasked: string | null;
  readonly holderName: string | null;
  readonly openingBalance: MoneyString;
  readonly openingDate: DateOnly;
  readonly active: boolean;
  readonly notes: string | null;
  readonly balance: MoneyString;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type NewAccount = Omit<AccountRecord, 'balance'>;

/** The editable columns; an absent key keeps the stored value. */
export type AccountPatch = Partial<
  Pick<
    AccountRecord,
    | 'name'
    | 'type'
    | 'institution'
    | 'currency'
    | 'identifierMasked'
    | 'holderName'
    | 'openingBalance'
    | 'openingDate'
    | 'active'
    | 'notes'
  >
> & { readonly updatedAt: string };

export interface TransferRecord {
  readonly id: string;
  readonly date: DateOnly;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountFrom: MoneyString;
  readonly amountTo: MoneyString;
  readonly feeAmount: MoneyString;
  readonly rate: MoneyString | null;
  readonly amountUsd: MoneyString;
  readonly reference: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly createdById: string | null;
}

/** `amount` is a positive magnitude for contributions and withdrawals, signed for `AJUSTE` (DT-106). */
export interface MovementRecord {
  readonly id: string;
  readonly accountId: string;
  readonly type: AccountMovementType;
  readonly date: DateOnly;
  readonly amount: MoneyString;
  readonly amountUsd: MoneyString;
  readonly partnerId: string | null;
  readonly description: string;
  readonly createdAt: string;
  readonly createdById: string | null;
}

/** A reconciliation leaves a record only; it never changes the balance (Q-BE3-5). */
export interface ReconciliationRecord {
  readonly id: string;
  readonly accountId: string;
  readonly date: DateOnly;
  readonly statementBalance: MoneyString;
  readonly systemBalance: MoneyString;
  readonly difference: MoneyString;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly createdById: string | null;
}

export type AccountStatusFilter = 'active' | 'inactive';

export interface AccountFilter {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: SortSpec;
  readonly q?: string;
  readonly types?: readonly AccountType[];
  readonly currencies?: readonly string[];
  /** Wins over `includeInactive` when present. */
  readonly statuses?: readonly AccountStatusFilter[];
  readonly includeInactive: boolean;
}

export const LEDGER_ENTRY_KIND_VALUES = [
  'OPENING_BALANCE',
  'PAYMENT',
  'EXPENSE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'APORTE_CAPITAL',
  'RETIRO_SOCIO',
  'AJUSTE',
] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KIND_VALUES)[number];

/** One row of the ledger with the running balance the database view computed over every entry. */
export interface LedgerRow {
  readonly id: string;
  readonly date: DateOnly;
  readonly kind: LedgerEntryKind;
  readonly source: {
    readonly type: EntityType;
    readonly id: string;
    readonly label: string;
  } | null;
  readonly description: string | null;
  /** Signed effect on the balance, in the account currency. */
  readonly amount: MoneyString;
  readonly balance: MoneyString;
}

export interface LedgerFilter {
  readonly accountId: string;
  readonly kinds?: readonly LedgerEntryKind[];
  readonly dateFrom?: DateOnly;
  readonly dateTo?: DateOnly;
  readonly q?: string;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Accounts, transfers, movements and reconciliations (PRD §8.7). Valid inside `UnitOfWorkPort.run` for
 * writes; the callers hold the `Account` row locks of the global lock order, so the adapter takes none.
 * `find` returns live accounts only (`null` when missing or archived).
 */
export interface AccountRepository {
  find(id: string): Promise<AccountRecord | null>;
  list(filter: AccountFilter): Promise<Paginated<AccountRecord>>;
  insert(account: NewAccount): Promise<void>;
  update(id: string, patch: AccountPatch): Promise<void>;
  /** Any payment, expense, transfer or movement (archived or voided included) points at the account. */
  hasMovements(id: string): Promise<boolean>;
  insertTransfer(transfer: TransferRecord): Promise<void>;
  insertMovement(movement: MovementRecord): Promise<void>;
  insertReconciliation(reconciliation: ReconciliationRecord): Promise<void>;
  /** Ledger rows through `account_ledger_v`, filtered and paged without changing their running balance. */
  ledger(filter: LedgerFilter): Promise<Paginated<LedgerRow>>;
}
