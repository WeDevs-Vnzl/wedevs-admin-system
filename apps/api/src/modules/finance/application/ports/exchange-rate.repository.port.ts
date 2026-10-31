import type { Paginated } from '../../../../shared/domain/pagination';
import type { RateSource } from '../../../../shared/domain/enums';
import type { SortSpec } from '../../../../shared/domain/list-query';
import type { RateRow } from '../../domain/rates';

/** One stored `ExchangeRate` row: `usdRate` is units of the currency per 1 USD, as a decimal string. */
export interface ExchangeRate {
  readonly id: string;
  /** Date-only `YYYY-MM-DD`. */
  readonly date: string;
  readonly currency: string;
  readonly usdRate: string;
  readonly source: RateSource;
  /** ISO 8601 UTC timestamp. */
  readonly createdAt: string;
  readonly createdById: string | null;
}

/** A rate to store; `id` and `createdAt` apply only when the key is new (an existing row keeps both). */
export interface ExchangeRateDraft {
  readonly id: string;
  readonly date: string;
  readonly currency: string;
  readonly usdRate: string;
  readonly source: RateSource;
  readonly createdAt: string;
  readonly createdById: string | null;
}

/** Filters of the Settings rates table; every field is optional and they combine with AND. */
export interface ExchangeRateFilter {
  readonly currency?: readonly string[];
  readonly source?: readonly RateSource[];
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

/** What `save` did with the key `(date, currency, source)`. */
export type SaveRateResult =
  | { readonly outcome: 'created' | 'updated'; readonly rate: ExchangeRate }
  | { readonly outcome: 'skipped'; readonly rate: null };

/** How `save` treats a key that is already stored: replace its rate, or leave the row untouched. */
export type RateConflictMode = 'overwrite' | 'skip';

/**
 * Access to the `ExchangeRate` table. Reads and writes run in the caller's unit of work when one is open.
 * A rate row is never deleted and a write never touches a snapshot another record took from it (C16).
 */
export interface ExchangeRateRepository {
  list(filter: ExchangeRateFilter): Promise<Paginated<ExchangeRate>>;

  /**
   * Every row of `currency` on the latest stored date on or before `date` (empty when there is none): the
   * input `selectRate` needs, without reading the whole history.
   */
  findEffective(currency: string, date: string): Promise<RateRow[]>;

  /**
   * Stores one rate atomically on its unique key `(date, currency, source)`: two writers of the same key
   * end with one row and no error, whichever commits last supplying the rate (`overwrite`). An existing
   * row keeps its id, `createdAt` and `createdById`; with `skip` it is left as it is.
   */
  save(draft: ExchangeRateDraft, onConflict: RateConflictMode): Promise<SaveRateResult>;
}

export const EXCHANGE_RATE_REPOSITORY = Symbol('EXCHANGE_RATE_REPOSITORY');
