import {
  addDays,
  daysBetween,
  isValidDateOnly,
  type DateOnly,
} from '../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import { roundMoney, toDecimal, type MoneyString } from '../../../shared/domain/money';

/** 'YYYY-MM'. */
export type MonthKey = string;
/** Inclusive date range; structurally the finance `KpiPeriod`. */
export type DateRange = { from: DateOnly; to: DateOnly };

export const REPORT_RANGE_PRESET_VALUES = [
  'THIS_MONTH',
  'PREVIOUS_MONTH',
  'QUARTER',
  'YEAR',
  'LAST_12_MONTHS',
  'CUSTOM',
] as const;
export type ReportRangePreset = (typeof REPORT_RANGE_PRESET_VALUES)[number];

export const REPORT_ID_VALUES = [
  'COLLECTED_BY_MONTH',
  'BILLED_VS_COLLECTED',
  'REVENUE_BY_CLIENT',
  'REVENUE_BY_PROJECT',
  'RECEIVABLES_AGING',
  'EXPENSES_BY_MONTH_CATEGORY',
  'NET_RESULT_MONTHLY',
  'ACCOUNT_FLOW',
  'COLLECTIONS_BY_METHOD',
  'TAXES_REGISTERED',
] as const;
export type ReportId = (typeof REPORT_ID_VALUES)[number];

export type ReportRangeFilter = {
  preset: ReportRangePreset;
  dateFrom?: DateOnly | undefined;
  dateTo?: DateOnly | undefined;
};

// ───────────────────────────── Months ─────────────────────────────

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, index - 1 + delta, 1)).toISOString().slice(0, 7);
}

export const monthStart = (month: MonthKey): DateOnly => `${month}-01`;
export const monthEnd = (month: MonthKey): DateOnly =>
  addDays(monthStart(shiftMonth(month, 1)), -1);
export const monthOf = (date: DateOnly): MonthKey => date.slice(0, 7);

/** The calendar months a range touches, in order. */
export function monthsOf(range: DateRange): MonthKey[] {
  const out: MonthKey[] = [];
  for (let month = monthOf(range.from); month <= monthOf(range.to); month = shiftMonth(month, 1)) {
    out.push(month);
  }
  return out;
}

// ───────────────────────────── Ranges ─────────────────────────────

function customRangeError(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ message: key, fieldErrors: { [field]: [key] } });
}

function resolveCustom(filter: ReportRangeFilter): DateRange {
  const { dateFrom, dateTo } = filter;
  if (dateFrom === undefined) {
    throw customRangeError('dateFrom', 'reports.validation.customRangeRequired');
  }
  if (dateTo === undefined) {
    throw customRangeError('dateTo', 'reports.validation.customRangeRequired');
  }
  if (!isValidDateOnly(dateFrom)) throw customRangeError('dateFrom', 'validation.date.invalid');
  if (!isValidDateOnly(dateTo)) throw customRangeError('dateTo', 'validation.date.invalid');
  if (dateFrom > dateTo) throw customRangeError('dateTo', 'reports.validation.rangeInverted');
  return { from: dateFrom, to: dateTo };
}

/**
 * Presets resolve from the Caracas business day to whole calendar months; `CUSTOM` is taken as is, once both
 * dates are real and ordered.
 */
export function resolveReportRange(filter: ReportRangeFilter, today: DateOnly): DateRange {
  const month = monthOf(today);
  const months = (first: MonthKey, last: MonthKey): DateRange => ({
    from: monthStart(first),
    to: monthEnd(last),
  });
  switch (filter.preset) {
    case 'THIS_MONTH':
      return months(month, month);
    case 'PREVIOUS_MONTH':
      return months(shiftMonth(month, -1), shiftMonth(month, -1));
    case 'QUARTER': {
      const first = shiftMonth(month, -((Number(month.slice(5)) - 1) % 3));
      return months(first, shiftMonth(first, 2));
    }
    case 'YEAR':
      return months(`${month.slice(0, 4)}-01`, `${month.slice(0, 4)}-12`);
    case 'LAST_12_MONTHS':
      return months(shiftMonth(month, -11), month);
    case 'CUSTOM':
      return resolveCustom(filter);
  }
}

/** The period just before, of the same length: whole months shift by months, other ranges by days. */
export function previousPeriod(range: DateRange): DateRange {
  if (range.from.endsWith('-01') && range.to === monthEnd(monthOf(range.to))) {
    const count = monthsOf(range).length;
    return {
      from: monthStart(shiftMonth(monthOf(range.from), -count)),
      to: monthEnd(shiftMonth(monthOf(range.to), -count)),
    };
  }
  const days = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.to, -days) };
}

/** The "close" of a range: its last day, or today while it runs (receivables, delinquency, DSO). */
export function rangeClose(range: DateRange, today: DateOnly): DateOnly {
  return range.to < today ? range.to : today;
}

// ───────────────────────────── Change ─────────────────────────────

/** `(value - previous) / |previous| * 100`, rounded to 2 dp; `null` when either side is missing or previous is zero. */
export function changePercent(
  value: MoneyString | null,
  previous: MoneyString | null,
): MoneyString | null {
  if (value === null || previous === null || toDecimal(previous).isZero()) return null;
  const delta = toDecimal(value).minus(toDecimal(previous));
  return roundMoney(delta.times(100).dividedBy(toDecimal(previous).abs()).toFixed());
}

// ───────────────────────────── Slugs ─────────────────────────────

/** `COLLECTED_BY_MONTH` to `collected-by-month`. */
export function reportSlugOf(id: ReportId): string {
  return id.toLowerCase().replaceAll('_', '-');
}

/** The report a URL slug names; `null` outside the whitelist. */
export function parseReportSlug(slug: string): ReportId | null {
  return REPORT_ID_VALUES.find((id) => reportSlugOf(id) === slug) ?? null;
}
