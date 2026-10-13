import type { RateSource } from "@/lib/validators/enums";
import { toDecimal, type MoneyString } from "./money";

/** Rate currency that is always worth exactly 1 USD. */
export const USD = "USD";

/** Source that wins the default when a date has several rates (DT-67). */
const PREFERRED_SOURCE: RateSource = "BCV";

/** One `ExchangeRate` row, reduced to what prefill needs. `date` is a date-only 'YYYY-MM-DD'. */
export type RateRow = {
  date: string;
  currency: string;
  usdRate: MoneyString;
  source: RateSource;
  /** ISO timestamp of when the row was created; breaks ties between sources. */
  createdAt: string;
};

/** One selectable rate of the effective date, labelled by its source (DT-67). */
export type RateOption = {
  source: RateSource;
  usdRate: MoneyString;
  createdAt: string;
};

export type SelectedRate = {
  /** Units of the currency per 1 USD, as a decimal string. Equals `options[0].usdRate` outside USD. */
  usdRate: MoneyString;
  /** Source of `usdRate` (`options[0]`); `null` for USD, which has no stored rate. */
  source: RateSource | null;
  /** True when the rate comes from an earlier date ("Usando tasa del dd/mm"). */
  isFallback: boolean;
  /** Date of the rows the rate was taken from (equals the requested date when not a fallback). */
  effectiveDate: string;
  /** Every usable rate of `effectiveDate` and the currency, default first; empty for USD. */
  options: RateOption[];
};

/**
 * Prefill order of PRD §9.2 at the date level, amended by DT-67: exact date and currency, else the
 * latest earlier date flagged as a fallback, else `null` (the user must type the rate). USD is always
 * "1". Dates are compared as 'YYYY-MM-DD' strings, which sort chronologically. Rows with a non-positive
 * or malformed rate are ignored.
 *
 * A date may hold one rate per source. All usable rates of the effective date are returned as `options`,
 * ordered `BCV` first, then by `createdAt` descending; the selected `usdRate`/`source` is `options[0]`.
 */
export function selectRate(
  rates: readonly RateRow[],
  date: string,
  currency: string,
): SelectedRate | null {
  if (currency === USD) {
    return { usdRate: "1", source: null, isFallback: false, effectiveDate: date, options: [] };
  }

  const usable = rates.filter((row) => row.currency === currency && isUsableRate(row.usdRate));

  let effectiveDate: string | undefined;
  if (usable.some((row) => row.date === date)) {
    effectiveDate = date;
  } else {
    for (const row of usable) {
      if (row.date < date && (effectiveDate === undefined || row.date > effectiveDate)) {
        effectiveDate = row.date;
      }
    }
  }
  if (effectiveDate === undefined) return null;

  const options = usable
    .filter((row) => row.date === effectiveDate)
    .sort(compareOptions)
    .map(({ source, usdRate, createdAt }) => ({ source, usdRate, createdAt }));
  const [selected] = options;
  if (!selected) return null;

  return {
    usdRate: selected.usdRate,
    source: selected.source,
    isFallback: effectiveDate !== date,
    effectiveDate,
    options,
  };
}

/** `BCV` first, then the most recent `createdAt`. `Array.sort` is stable, so equal rows keep input order. */
function compareOptions(a: RateOption, b: RateOption): number {
  const aPreferred = a.source === PREFERRED_SOURCE;
  const bPreferred = b.source === PREFERRED_SOURCE;
  if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
  return timestamp(b.createdAt) - timestamp(a.createdAt);
}

function timestamp(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function isUsableRate(value: MoneyString): boolean {
  try {
    return toDecimal(value).greaterThan(0);
  } catch {
    return false;
  }
}

export const DEFAULT_RATE_DEVIATION_PERCENT = "10";

/**
 * True when `newRate` differs from `lastRate` by strictly more than `thresholdPercent` percent of
 * `lastRate` (PRD §15 warning). With no previous rate there is nothing to compare, so false.
 */
export function rateDeviationExceeds(
  newRate: MoneyString,
  lastRate: MoneyString | null | undefined,
  thresholdPercent: MoneyString = DEFAULT_RATE_DEVIATION_PERCENT,
): boolean {
  if (lastRate === null || lastRate === undefined) return false;
  const last = toDecimal(lastRate);
  if (!last.greaterThan(0)) return false;
  const deviation = toDecimal(newRate).minus(last).abs().dividedBy(last).times(100);
  return deviation.greaterThan(toDecimal(thresholdPercent));
}
