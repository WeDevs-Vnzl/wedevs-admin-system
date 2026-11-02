import type { MoneyString } from '../../../../../shared/domain/money';
import type { MonthKey } from '../../../domain/report-range';
import type { KpiId, KpiUnit } from './kpi-catalog';
import type { ResolvedRangeOutput } from './report-types';

export interface KpiBreakdownOutput {
  readonly key: string;
  /** User data (a client or project name); absent when the key says it all. */
  readonly label?: string;
  readonly value: MoneyString;
}

/** One KPI card: the value over the range, the previous period's, the change and a 12-month sparkline. */
export interface KpiOutput {
  readonly id: KpiId;
  readonly unit: KpiUnit;
  /** `null` when there is not enough data (no delivered projects, nothing billed...). */
  readonly value: MoneyString | null;
  readonly previousValue: MoneyString | null;
  readonly changePercent: MoneyString | null;
  /** The KPI over each of the 12 months ending at the range's last month; months without data are left out. */
  readonly sparkline: { period: MonthKey; value: MoneyString }[];
  readonly breakdown?: KpiBreakdownOutput[];
}

export interface KpisOutput {
  readonly range: ResolvedRangeOutput;
  /** The period just before, of the same length, that `previousValue` is measured over. */
  readonly previousRange: ResolvedRangeOutput;
  /** The 18 cards in catalog order. */
  readonly kpis: KpiOutput[];
}
