import type { CurrencyRepository } from './ports/currency.repository.port';

/**
 * Tells which currency codes exist in the catalog, active or not, as the foreign key of the tables that point at
 * it does. Exported for BE-3's exchange rates. Read-only: it never writes and carries no `can()` (reference
 * catalog read, DT-71).
 */
export class CurrencyCatalogQuery {
  constructor(private readonly currencies: CurrencyRepository) {}

  async knownCodes(codes: readonly string[]): Promise<ReadonlySet<string>> {
    if (codes.length === 0) return new Set();
    const requested = new Set(codes);
    const rows = await this.currencies.list();
    return new Set(rows.filter((row) => requested.has(row.code)).map((row) => row.code));
  }
}
