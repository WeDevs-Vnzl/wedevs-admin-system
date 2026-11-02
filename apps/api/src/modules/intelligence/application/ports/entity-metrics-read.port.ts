import type { MoneyString } from '../../../../shared/domain/money';
import type { ClientStatus, ProjectStatus } from '../../../../shared/domain/enums';

export const ENTITY_METRICS_READ = Symbol('ENTITY_METRICS_READ');

export type ClientMetricsView = {
  clientId: string;
  code: string;
  tradeName: string;
  status: ClientStatus;
  invoicedUsd: MoneyString;
  collectedUsd: MoneyString;
  receivableUsd: MoneyString;
  overdueUsd: MoneyString;
  creditUsd: MoneyString;
  projectCount: number;
  lastActivityAt: Date | null;
};

export type ProjectMetricsView = {
  projectId: string;
  code: string;
  name: string;
  status: ProjectStatus;
  contractedUsd: MoneyString;
  invoicedUsd: MoneyString;
  collectedUsd: MoneyString;
  toInvoiceUsd: MoneyString;
  receivableUsd: MoneyString;
  expensesUsd: MoneyString;
  marginUsd: MoneyString;
  monthlyRecurringUsd: MoneyString;
  /** margin x 100 / collected, two decimals; `null` while nothing is collected. Computed on read. */
  marginPercent: MoneyString | null;
};

export const CLIENT_RANK_METRICS = ['invoiced', 'collected', 'receivable', 'overdue'] as const;
export type ClientRankMetric = (typeof CLIENT_RANK_METRICS)[number];

export const PROJECT_RANK_METRICS = [
  'invoiced',
  'collected',
  'toInvoice',
  'receivable',
  'margin',
] as const;
export type ProjectRankMetric = (typeof PROJECT_RANK_METRICS)[number];

/**
 * Read side over `ClientMetrics` and `ProjectMetrics` (DT-111, data-rules §3b). Archived clients and
 * projects are never listed or counted. A client or project without a metrics row reads as zeros (the
 * read model is created lazily). Money is a decimal string. Use cases call `can()` first.
 */
export interface EntityMetricsReadPort {
  /** Every live client with its metrics, by trade name, then id. */
  clientRows(): Promise<ClientMetricsView[]>;

  /**
   * The `limit` live clients with the largest `metric`, ties by trade name then id. Clients whose value is
   * not above zero are left out.
   */
  topClients(metric: ClientRankMetric, limit: number): Promise<ClientMetricsView[]>;

  /** Live clients per status; every status is present. */
  clientCountsByStatus(): Promise<Record<ClientStatus, number>>;

  /** Every live project with its metrics, by name, then id. */
  projectRows(): Promise<ProjectMetricsView[]>;

  /** As `topClients`; for `margin` the value must be above zero too. */
  topProjects(metric: ProjectRankMetric, limit: number): Promise<ProjectMetricsView[]>;

  /** Live projects per status; every status is present. */
  projectCountsByStatus(): Promise<Record<ProjectStatus, number>>;
}
