import type { DateOnly } from '../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  monthEnd,
  monthOf,
  monthStart,
  shiftMonth,
  type DateRange,
  type MonthKey,
} from './report-range';

export const DASHBOARD_PERIOD_VALUES = ['month', 'quarter', 'year'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIOD_VALUES)[number];

export type DashboardPeriodRange = {
  period: DashboardPeriod;
  start: DateOnly;
  end: DateOnly;
  /** The period's last day, or today while it runs (A12). */
  close: DateOnly;
  /** The period just before, of the same kind; its close is its last day. */
  previous: { start: DateOnly; end: DateOnly; close: DateOnly };
};

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonthKey(value: string): boolean {
  return MONTH_KEY.test(value);
}

/** The Caracas business month of `today`. */
export function businessMonthOf(today: DateOnly): MonthKey {
  return monthOf(today);
}

function invalid(field: string): ValidationFailedError {
  const key = `dashboard.validation.${field}`;
  return new ValidationFailedError({ message: key, fieldErrors: { [field]: [key] } });
}

const MONTHS_PER_PERIOD: Record<DashboardPeriod, number> = { month: 1, quarter: 3, year: 12 };

function rangeOf(period: DashboardPeriod, anchor: MonthKey): DateRange {
  const index = Number(anchor.slice(5)) - 1;
  const first =
    period === 'month'
      ? anchor
      : period === 'quarter'
        ? shiftMonth(anchor, -(index % 3))
        : `${anchor.slice(0, 4)}-01`;
  return {
    from: monthStart(first),
    to: monthEnd(shiftMonth(first, MONTHS_PER_PERIOD[period] - 1)),
  };
}

/**
 * The calendar month, quarter or year that `anchor` (YYYY-MM) falls in, with its close and the previous
 * period of the same kind (DT-173, A12). The close is the last day, or today while the period runs.
 */
export function dashboardPeriodRange(
  period: DashboardPeriod,
  anchor: MonthKey,
  today: DateOnly,
): DashboardPeriodRange {
  if (!(DASHBOARD_PERIOD_VALUES as readonly string[]).includes(period)) throw invalid('period');
  if (!isMonthKey(anchor)) throw invalid('month');
  const range = rangeOf(period, anchor);
  const previous = rangeOf(period, shiftMonth(monthOf(range.from), -MONTHS_PER_PERIOD[period]));
  return {
    period,
    start: range.from,
    end: range.to,
    close: range.to < today ? range.to : today,
    previous: { start: previous.from, end: previous.to, close: previous.to },
  };
}

/** `count` consecutive months ending at `lastMonth`, oldest first (A14). */
export function trailingMonths(lastMonth: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(lastMonth, i - (count - 1)));
}
