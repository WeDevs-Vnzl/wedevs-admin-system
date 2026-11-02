import type { DateOnly } from '../../../../shared/domain/business-date';
import type { MoneyString } from '../../../../shared/domain/money';
import type { FinanceFactKind } from '../../../finance/application/kpi-api';
import type { DateRange, MonthKey } from '../../domain/report-range';

export const FINANCE_FACTS_READ = Symbol('FINANCE_FACTS_READ');

/** Every `FinanceFactKind`, in the order amounts are listed. */
export const FACT_KINDS = [
  'BILLED',
  'COLLECTED',
  'EXPENSE_PAID',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'MOVEMENT_IN',
  'MOVEMENT_OUT',
  'IVA',
  'WITHHELD_IVA',
  'WITHHELD_ISLR',
  'WITHHELD_OTHER',
  'IGTF',
] as const satisfies readonly FinanceFactKind[];

// Compile-time proof that the list above misses no kind.
type MissingKind = Exclude<FinanceFactKind, (typeof FACT_KINDS)[number]>;
export const FACT_KINDS_COMPLETE: [MissingKind] extends [never] ? true : never = true;

/** Decimal-string amounts for the requested kinds; a kind without facts is `'0.00'`. */
export type KindAmounts<K extends FinanceFactKind = FinanceFactKind> = Record<K, MoneyString>;

/**
 * Narrows the facts. `clientId` and `projectId` match the fact's own columns (an expense fact has no
 * client, so a client filter leaves it out). `tagId` matches a fact whose client or project carries the tag
 * through `TagAssignment` (DT-170). Filters combine with AND.
 */
export type FactFilter = {
  clientId?: string | undefined;
  projectId?: string | undefined;
  tagId?: string | undefined;
};

export type MonthlyFacts<K extends FinanceFactKind = FinanceFactKind> = {
  month: MonthKey;
  amounts: KindAmounts<K>;
};

/** The dimension a total is grouped by. A fact without a value in it is left out. */
export type FactDimension = 'client' | 'project' | 'account' | 'method' | 'category';

export type FactGroupRow<K extends FinanceFactKind = FinanceFactKind> = {
  /** The client, project, account, payment method or **root** expense category id. */
  key: string;
  amounts: KindAmounts<K>;
};

export type ReceivableAt = {
  /** BILLED − WITHHELD_* − COLLECTED of the open invoices (DT-125), in USD. */
  totalUsd: MoneyString;
  /** The part of `totalUsd` whose invoice is due before the close date. */
  overdueUsd: MoneyString;
};

export type AgingBuckets = {
  d0_30: MoneyString;
  d31_60: MoneyString;
  d61_90: MoneyString;
  d90plus: MoneyString;
};

export type AgingRow = {
  clientId: string;
  buckets: AgingBuckets;
  totalUsd: MoneyString;
};

export type ReceivablesAging = {
  rows: AgingRow[];
  totals: AgingBuckets;
  totalUsd: MoneyString;
};

export type IvaByRateRow = {
  /** The IVA rate in percent, two decimals, as a decimal string (`'16.00'`). */
  ivaRate: MoneyString;
  amountUsd: MoneyString;
};

/**
 * Read side over `FinanceFact` (DT-125, data-rules §3b). Every amount is a USD snapshot taken when the fact
 * was written and is summed in the database, never recomputed with a rate (C16); sums reach Node as decimal
 * strings (C15). A voided, draft or archived source has no facts: the projector deletes them in the writer's
 * unit of work, so this port reads facts only and adds nothing for such a source.
 *
 * Reads run in the caller's transaction when there is one, and need no authorization of their own: use
 * cases call `can()` before reading (backend-architecture §5).
 */
export interface FinanceFactsReadPort {
  /** Totals by kind over the inclusive date range. Every kind is present. */
  sumByKind(range: DateRange, filter?: FactFilter): Promise<KindAmounts>;

  /**
   * One entry per calendar month the range touches, ascending, months with no facts as zeros. Facts are
   * limited to the range's dates, so the first and last months can be partial.
   */
  monthlySeries<K extends FinanceFactKind>(
    range: DateRange,
    kinds: readonly K[],
    filter?: FactFilter,
  ): Promise<MonthlyFacts<K>[]>;

  /** Totals of `kinds` per value of `dimension`, ordered by key ascending (byte order). */
  sumBy<K extends FinanceFactKind>(
    dimension: FactDimension,
    range: DateRange,
    kinds: readonly K[],
    filter?: FactFilter,
  ): Promise<FactGroupRow<K>[]>;

  /**
   * Receivable at the end of `close`: per invoice, BILLED − WITHHELD_* − COLLECTED over facts dated up to
   * `close`; only balances above zero count. Overdue means the invoice's `dueDate` is before `close`.
   */
  /** Under a filter, each invoice's withholding counts by the share of its filtered billed amount. */
  receivableAt(close: DateOnly, filter?: FactFilter): Promise<ReceivableAt>;

  /**
   * The same balances grouped by client and by days past due at `close` (on `dueDate`): up to 30 days
   * including not yet due, 31 to 60, 61 to 90, over 90. Rows are ordered by total, largest first.
   */
  agingAt(close: DateOnly, filter?: FactFilter): Promise<ReceivablesAging>;

  /** `IVA` facts of the range by rate, rates ascending (A7). */
  ivaByRate(range: DateRange, filter?: FactFilter): Promise<IvaByRateRow[]>;
}
