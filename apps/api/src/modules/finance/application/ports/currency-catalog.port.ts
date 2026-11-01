/** The currency catalog as the exchange-rate use cases need it. Settings owns the table. */
export interface CurrencyCatalogPort {
  /** The subset of `codes` that exist in the catalog, active or not. */
  knownCodes(codes: readonly string[]): Promise<ReadonlySet<string>>;
}

export const CURRENCY_CATALOG = Symbol('CURRENCY_CATALOG');
