import type { DateOnly } from '../../../../shared/domain/business-date';
import type { DocumentStatus } from '../../../../shared/domain/enums';
import type { MoneyString } from '../../../../shared/domain/money';
import type { ActivityListCriteria } from '../../../platform/application/ports/activity-read.port';

export const OVERVIEW_READ = Symbol('OVERVIEW_READ');

export type TechnologyUsageRow = {
  id: string;
  name: string;
  nameEn: string | null;
  category: string;
  iconSlug: string | null;
  color: string | null;
  /** Live projects that carry the technology. */
  projectCount: number;
};

/** Live (not draft, voided or archived) invoices of one currency, in that currency. */
export type InvoiceCurrencyTotal = {
  currency: string;
  total: MoneyString;
  balance: MoneyString;
  /** The balance of the `VENCIDA` ones. */
  overdue: MoneyString;
  /** `VENCIDA` invoices with a balance. */
  overdueCount: number;
};

export type PaymentQueues = {
  /** Live payments waiting for verification. */
  pendingVerificationCount: number;
  /** Confirmed payments that still hold credit. */
  unallocatedCount: number;
  /** Their credit in USD, each converted at its own stored rate. */
  unallocatedTotalUsd: MoneyString;
};

export type DocumentCategoryCounts = {
  id: string;
  name: string;
  nameEn: string | null;
  color: string | null;
  /** Live documents of the category per status; a status without documents is absent. */
  countByStatus: Partial<Record<DocumentStatus, number>>;
};

/** Cumulative: a document expiring in 10 days counts in all three. */
export type ExpiringCounts = { days30: number; days60: number; days90: number };

export type ActivityCounts = { total: number; today: number; users: number };

/**
 * Read-only aggregates the module overviews need and the finance-facts and entity-metrics ports do not
 * cover (DT-113, DT-174): live counts, labels of grouped keys and the queues. Sums reach Node as decimal
 * strings (C15). Use cases call `can()` first; nothing here authorizes.
 */
export interface OverviewReadPort {
  /** The most used technologies over live projects: count descending, then id ascending. */
  topTechnologies(limit: number): Promise<TechnologyUsageRow[]>;

  /** One entry per currency of the live invoices, currency ascending. */
  invoiceCurrencyTotals(): Promise<InvoiceCurrencyTotal[]>;

  /** Payment method id to its code and name; unknown ids are absent. */
  paymentMethodLabels(ids: readonly string[]): Promise<Map<string, { code: string; name: string }>>;

  /** Account id to its name (inactive accounts included); unknown ids are absent. */
  accountNames(ids: readonly string[]): Promise<Map<string, string>>;

  /** Expense category id to its name; unknown ids are absent. */
  expenseCategoryNames(ids: readonly string[]): Promise<Map<string, string>>;

  paymentQueues(): Promise<PaymentQueues>;

  /** Sum of `monthlyAmountUsd` of the active recurring expenses (DT-100). */
  committedMonthlyUsd(): Promise<MoneyString>;

  /** Every document category in display order, with its live documents per status. */
  documentCategoryCounts(): Promise<DocumentCategoryCounts[]>;

  /**
   * Live documents expiring from `today` to `today` + 30, 60 and 90 days inclusive, `VENCIDO` and `ANULADO`
   * left out.
   */
  documentExpiringCounts(today: DateOnly): Promise<ExpiringCounts>;

  /**
   * The activity figures: `total` under `filter`, `today` (events inside `[todayStart, tomorrowStart)`, no
   * other filter) and `users` (`total` restricted to actions of users).
   */
  activityCounts(request: {
    filter: ActivityListCriteria;
    todayStart: Date;
    tomorrowStart: Date;
  }): Promise<ActivityCounts>;
}
