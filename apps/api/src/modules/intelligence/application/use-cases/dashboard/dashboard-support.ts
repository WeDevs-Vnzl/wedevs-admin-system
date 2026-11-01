import type { MoneyString } from '../../../../../shared/domain/money';

export const ZERO: MoneyString = '0.00';

/** The eight cards of PRD §8.1, in display order. The ids are stable keys; the UI labels by `period`. */
export const DASHBOARD_KPI_IDS = [
  'COLLECTED_MONTH',
  'BILLED_MONTH',
  'RECEIVABLE',
  'EXPENSES_MONTH',
  'RESULT_MONTH',
  'ACCOUNTS_BALANCE',
  'MRR',
  'ACTIVE_PROJECTS',
] as const;
export type DashboardKpiId = (typeof DASHBOARD_KPI_IDS)[number];

export const DASHBOARD_KPI_UNITS: Record<DashboardKpiId, 'USD' | 'COUNT'> = {
  COLLECTED_MONTH: 'USD',
  BILLED_MONTH: 'USD',
  RECEIVABLE: 'USD',
  EXPENSES_MONTH: 'USD',
  RESULT_MONTH: 'USD',
  ACCOUNTS_BALANCE: 'USD',
  MRR: 'USD',
  ACTIVE_PROJECTS: 'COUNT',
};

export interface KpiCardOutput {
  readonly id: DashboardKpiId;
  readonly unit: 'USD' | 'COUNT';
  readonly value: MoneyString;
  /** The previous period at its own close; `null` where no history exists. */
  readonly previousValue: MoneyString | null;
  readonly changePercent: MoneyString | null;
  /** `RECEIVABLE`: the overdue part. */
  readonly secondaryValue: MoneyString | null;
}

// The vocabulary of the dashboard input, for the interface layer (it cannot reach the domain directly).
export { DASHBOARD_PERIOD_VALUES, type DashboardPeriod } from '../../../domain/dashboard-period';
