import type { DateOnly } from '../../../../shared/domain/business-date';
import type { ProjectStatus, RecurringStatus } from '../../../../shared/domain/enums';
import type { MoneyString } from '../../../../shared/domain/money';
import type { DateRange, MonthKey } from '../../domain/report-range';
import type { FactFilter } from './finance-facts-read.port';

export const REPORT_INPUTS_READ = Symbol('REPORT_INPUTS_READ');

/** The report filters that narrow rows: a client, a project, a tag (all optional, combined with AND). */
export type ReportScope = FactFilter;

/** Everything the label of a report row needs. `code` is `null` when the record has none. */
export type LabelKind = 'CLIENT' | 'PROJECT' | 'ACCOUNT' | 'TECHNOLOGY' | 'CATEGORY' | 'METHOD';
export type LabelRow = { id: string; label: string; code: string | null };

export type ScopeRecordKind = 'CLIENT' | 'PROJECT' | 'TAG';

/** One root expense category in one month (the `category` dimension of the facts port, per month). */
export type CategoryMonthRow = { categoryId: string; month: MonthKey; amountUsd: MoneyString };

/** Money into and out of one account in one month, from facts only. */
export type AccountFlowRow = {
  accountId: string;
  month: MonthKey;
  inflowUsd: MoneyString;
  outflowUsd: MoneyString;
};

/** One IVA rate in one month: the tax base in USD at the invoice's stored rate, the IVA from `IVA` facts. */
export type TaxRateMonthRow = {
  month: MonthKey;
  /** Percent, two decimals (`'16.00'`). */
  ivaRate: MoneyString;
  taxBaseUsd: MoneyString;
  ivaAmountUsd: MoneyString;
};

/** Withholdings suffered and IGTF recorded in one month, in USD. */
export type TaxWithholdingMonthRow = {
  month: MonthKey;
  ivaWithheldUsd: MoneyString;
  islrWithheldUsd: MoneyString;
  otherWithheldUsd: MoneyString;
  igtfUsd: MoneyString;
};

export type TaxesByMonth = {
  rates: TaxRateMonthRow[];
  withholdings: TaxWithholdingMonthRow[];
};

/** Receivable and its overdue part at one close date (DT-125). */
export type ReceivableClose = { close: DateOnly; totalUsd: MoneyString; overdueUsd: MoneyString };

/** Confirmed allocations of one client on one day (`COLLECTED` facts, DT-98), in USD. */
export type ClientCollectionDay = { clientId: string; date: DateOnly; amountUsd: MoneyString };

/** What one project collected and spent inside one window; `window` indexes the windows asked for. */
export type ProjectFlowRow = {
  window: number;
  projectId: string;
  collectedUsd: MoneyString;
  expensesUsd: MoneyString;
};

/** A recurring charge with its USD monthly snapshot (DT-100). */
export type RecurringChargeRow = {
  startDate: DateOnly;
  endDate: DateOnly | null;
  status: RecurringStatus;
  monthlyAmountUsd: MoneyString;
};

export type RecurringExpenseRow = { status: RecurringStatus; monthlyAmountUsd: MoneyString };

/** A live account's cached balance in its own currency. */
export type AccountBalanceRow = { currency: string; balance: MoneyString };

/** A live project with what the delivery, ticket, stack and coverage KPIs read. */
export type KpiProjectRow = {
  id: string;
  status: ProjectStatus;
  startDate: DateOnly | null;
  targetEndDate: DateOnly | null;
  endDate: DateOnly | null;
  /** `BillingPlan.contractedUsd`; `null` without a plan. */
  contractedUsd: MoneyString | null;
  technologyIds: string[];
  /** A `FIRMADO` services contract linked to the project or to one of its clients. */
  hasSignedContract: boolean;
  /** `expiresAt` of each not-void NDA linked to the project or to one of its clients (`null`: no expiry). */
  ndaExpiries: (DateOnly | null)[];
};

/** A live client with the business days (America/Caracas) the lifecycle KPIs read. */
export type KpiClientRow = { id: string; createdAt: DateOnly; activatedAt: DateOnly | null };

/**
 * Report and KPI inputs that `FinanceFactsReadPort` does not give (data-rules §3b, DT-102): several
 * windows or close dates in one query, tax bases, recurring snapshots, delivery and lifecycle rows. Reads
 * only, every amount a decimal string summed in the database (C15, C16); a scope narrows rows like the facts
 * port does. Use cases call `can()` before reading (backend-architecture §5).
 */
export interface ReportInputsReadPort {
  /** Whether the live (not deleted) record exists; a filter id is never trusted before this (C14). */
  exists(kind: ScopeRecordKind, id: string): Promise<boolean>;

  /** Labels of the ids that exist; ids of deleted records still resolve, so history keeps its names. */
  labels(kind: LabelKind, ids: readonly string[]): Promise<LabelRow[]>;

  /** `EXPENSE_PAID` facts by month and **root** expense category over the range. */
  expensesByMonthCategory(range: DateRange, scope: ReportScope): Promise<CategoryMonthRow[]>;

  /** Inflow and outflow per account and month; only months with movement. */
  accountFlow(range: DateRange, scope: ReportScope): Promise<AccountFlowRow[]>;

  /**
   * Taxes by month over the range. An invoice counts whole when one of its `BILLED` facts matches the scope
   * (the mock's rule); IGTF follows its payment the same way when the scope names a project or a tag.
   */
  taxesByMonth(range: DateRange, scope: ReportScope): Promise<TaxesByMonth>;

  /** Receivable and overdue at each close date, one query for all; same definition as the facts port. */
  receivableAt(closes: readonly DateOnly[], scope: ReportScope): Promise<ReceivableClose[]>;

  /** `COLLECTED` facts up to `upTo` (all history), grouped by client and day. */
  collectionsByClientDay(upTo: DateOnly, scope: ReportScope): Promise<ClientCollectionDay[]>;

  /** Per project collected and paid expenses inside each window (`window` is the index in `windows`). */
  projectFlows(windows: readonly DateRange[], scope: ReportScope): Promise<ProjectFlowRow[]>;

  /** Every recurring charge of a live project in scope; the caller picks the ones active at a date. */
  recurringCharges(scope: ReportScope): Promise<RecurringChargeRow[]>;

  /** Every live recurring expense in scope (one without a project only when no scope is given). */
  recurringExpenses(scope: ReportScope): Promise<RecurringExpenseRow[]>;

  /** Balances of the live, active accounts. */
  accountBalances(): Promise<AccountBalanceRow[]>;

  /** Live projects in scope. */
  kpiProjects(scope: ReportScope): Promise<KpiProjectRow[]>;

  /** Live clients in scope. */
  kpiClients(scope: ReportScope): Promise<KpiClientRow[]>;
}
