// Catalog values of PRD §10.4 / data-rules §9; cross-checked against fe/src/mocks/fixtures/catalogs.ts.
export interface CurrencySeed {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  active: boolean;
}

export const CURRENCIES: readonly CurrencySeed[] = [
  { code: 'USD', name: 'Dólar estadounidense', symbol: '$', decimals: 2, active: true },
  { code: 'VES', name: 'Bolívar venezolano', symbol: 'Bs.', decimals: 2, active: true },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, active: true },
  { code: 'USDT', name: 'Tether (USDT)', symbol: 'USDT', decimals: 2, active: true },
  { code: 'COP', name: 'Peso colombiano', symbol: 'COL$', decimals: 2, active: true },
];
