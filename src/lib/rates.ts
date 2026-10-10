import { toDecimal, type MoneyString } from "./money";

/** Rate currency that is always worth exactly 1 USD. */
export const USD = "USD";

/** One `ExchangeRate` row, reduced to what prefill needs. `date` is a date-only 'YYYY-MM-DD'. */
export type RateRow = {
  date: string;
  currency: string;
  usdRate: MoneyString;
};

export type SelectedRate = {
  /** Units of the currency per 1 USD, as a decimal string. */
  usdRate: MoneyString;
  /** True when the rate comes from an earlier date ("Usando tasa del dd/mm"). */
  isFallback: boolean;
  /** Date of the row the rate was taken from (equals the requested date when not a fallback). */
  effectiveDate: string;
};

/**
 * Prefill order of PRD §9.2: exact date and currency, else the latest earlier rate flagged as a
 * fallback, else `null` (the user must type the rate). USD is always "1". Dates are compared as
 * 'YYYY-MM-DD' strings, which sort chronologically. Rows with a non-positive rate are ignored;
 * if several rows share a date, the first one wins.
 */
export function selectRate(
  rates: readonly RateRow[],
  date: string,
  currency: string,
): SelectedRate | null {
  if (currency === USD) return { usdRate: "1", isFallback: false, effectiveDate: date };

  let exact: RateRow | undefined;
  let previous: RateRow | undefined;
  for (const row of rates) {
    if (row.currency !== currency || !isUsableRate(row.usdRate)) continue;
    if (row.date === date) {
      exact ??= row;
    } else if (row.date < date && (!previous || row.date > previous.date)) {
      previous = row;
    }
  }

  if (exact) return { usdRate: exact.usdRate, isFallback: false, effectiveDate: exact.date };
  if (previous) {
    return { usdRate: previous.usdRate, isFallback: true, effectiveDate: previous.date };
  }
  return null;
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
