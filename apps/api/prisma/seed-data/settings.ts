// PRD §10.4: fiscal settings (Δ1: ivaRates + ivaDefaultRate) and the six sequences at 0.
// Decimal values are strings.
export const FISCAL_SETTING = {
  ivaRates: ['16', '8', '0'],
  ivaDefaultRate: '16',
  igtfRate: '3',
  igtfCurrencies: ['USD', 'EUR', 'USDT'],
  igtfMethodCodes: ['EFECTIVO_USD', 'ZELLE', 'ZINLI', 'PAYPAL', 'USDT_CRIPTO'],
  invoiceDefaultDueDays: 15,
};

export const SETTINGS: readonly { key: string; value: unknown }[] = [
  { key: 'fiscal', value: FISCAL_SETTING },
  { key: 'invoice.defaultDueDays', value: 15 },
];

export const SEQUENCES: readonly string[] = ['CLI', 'PRY', 'FAC', 'PAG', 'GAS', 'DOC'];
