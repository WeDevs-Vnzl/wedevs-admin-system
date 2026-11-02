import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import type { MoneyString } from '../../../../../shared/domain/money';
import type { MonthKey } from '../../../domain/report-range';

/** The range a report was computed for, after the preset resolved (PRD §8.13). */
export interface ResolvedRangeOutput {
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface SeriesPointOutput {
  readonly period: MonthKey;
  readonly value: MoneyString;
}

export interface ChartSeriesOutput {
  readonly id: string;
  readonly label?: string;
  readonly values: MoneyString[];
}

export interface AgingBucketsOutput {
  readonly d0_30: MoneyString;
  readonly d31_60: MoneyString;
  readonly d61_90: MoneyString;
  readonly d90plus: MoneyString;
}

export interface IvaByRateOutput {
  readonly ivaRate: MoneyString;
  readonly taxBase: MoneyString;
  readonly ivaAmount: MoneyString;
}

export interface TaxesPeriodOutput {
  readonly ivaByRate: IvaByRateOutput[];
  readonly ivaTotal: MoneyString;
  readonly ivaWithheld: MoneyString;
  readonly islrWithheld: MoneyString;
  readonly otherWithheld: MoneyString;
  readonly igtf: MoneyString;
}

interface ReportBase {
  readonly currency: 'USD';
  readonly range: ResolvedRangeOutput;
}

/** The ten reports of PRD §8.13.1, discriminated by `reportId`; every amount is a USD decimal string. */
/** `value` is `null` under a client filter: expense facts carry no client. */
export interface NetResultPoint {
  period: MonthKey;
  value: MoneyString | null;
}

export type ReportOutput =
  | (ReportBase & { reportId: 'COLLECTED_BY_MONTH'; points: SeriesPointOutput[] })
  | (ReportBase & {
      reportId: 'BILLED_VS_COLLECTED';
      chart: { periods: MonthKey[]; series: ChartSeriesOutput[] };
    })
  | (ReportBase & {
      reportId: 'REVENUE_BY_CLIENT';
      rows: { client: EntityRef; collected: MoneyString; billed: MoneyString }[];
    })
  | (ReportBase & {
      reportId: 'REVENUE_BY_PROJECT';
      rows: {
        project: EntityRef;
        collected: MoneyString;
        margin: MoneyString | null;
        marginPercent: MoneyString | null;
      }[];
    })
  | (ReportBase & {
      reportId: 'RECEIVABLES_AGING';
      rows: { client: EntityRef; buckets: AgingBucketsOutput; total: MoneyString }[];
      totals: AgingBucketsOutput;
    })
  | (ReportBase & {
      reportId: 'EXPENSES_BY_MONTH_CATEGORY';
      chart: { periods: MonthKey[]; series: ChartSeriesOutput[] };
    })
  | (ReportBase & { reportId: 'NET_RESULT_MONTHLY'; points: NetResultPoint[] })
  | (ReportBase & {
      reportId: 'ACCOUNT_FLOW';
      rows: { account: EntityRef; period: MonthKey; inflow: MoneyString; outflow: MoneyString }[];
    })
  | (ReportBase & {
      reportId: 'COLLECTIONS_BY_METHOD';
      rows: { methodId: string; methodCode: string; collected: MoneyString; share: MoneyString }[];
    })
  | (ReportBase & {
      reportId: 'TAXES_REGISTERED';
      months: ({ period: MonthKey } & TaxesPeriodOutput)[];
      totals: TaxesPeriodOutput;
    });

export type ReportId = ReportOutput['reportId'];
