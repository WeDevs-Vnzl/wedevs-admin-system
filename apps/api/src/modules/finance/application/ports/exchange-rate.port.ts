import type { SelectedRate } from '../../domain/rates';

/**
 * Rate source every finance slice and the BE-5 jobs read from (PRD §9.2, DT-67). It answers the prefill
 * order of `selectRate`: the exact date, else the latest earlier one flagged as a fallback, else `null`
 * (the user types the rate). USD is always `"1"` with no source. The port only reads: a snapshot taken from
 * it is stored by the caller and never recomputed (C16).
 */
export interface ExchangeRatePort {
  /** `date` is a date-only `YYYY-MM-DD`; `currency` an upper-case code. */
  getRateFor(date: string, currency: string): Promise<SelectedRate | null>;
}

export const EXCHANGE_RATE = Symbol('EXCHANGE_RATE');
