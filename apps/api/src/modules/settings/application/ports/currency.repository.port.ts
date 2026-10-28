import type { Currency } from '../../domain/currency';

/**
 * Access to the `Currency` table. Reads and writes run in the caller's unit of work when one is open. Rows are
 * never deleted (C19): a retired currency is written with `active: false`.
 */
export interface CurrencyRepository {
  /** Every row, active or not; the use case filters and orders them. */
  list(): Promise<Currency[]>;
  /** `null` when no row has the code. */
  findByCode(code: string): Promise<Currency | null>;
  /** Inserts a new row. A code that is already stored throws `ConflictError` (field `code`). */
  insert(currency: Currency): Promise<void>;
  /** Writes the editable fields of an existing row, found by its code. */
  update(currency: Currency): Promise<void>;
}

export const CURRENCY_REPOSITORY = Symbol('CURRENCY_REPOSITORY');
