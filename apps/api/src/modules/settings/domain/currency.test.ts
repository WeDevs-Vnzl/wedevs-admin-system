import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  CURRENCY_MESSAGES,
  assertCurrencyCode,
  assertCurrencyActivation,
  currencyChanges,
  currencyCreationChanges,
  normalizeCurrencyFields,
  sortCurrencies,
  type Currency,
} from './currency';

const COP: Currency = {
  code: 'COP',
  name: 'Peso colombiano',
  symbol: 'COL$',
  decimals: 2,
  active: true,
};

function fieldErrorsOf(action: () => unknown): Record<string, string[]> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationFailedError) return error.fieldErrors ?? {};
    throw error;
  }
  return {};
}

describe('currency rules (catalogs.test "currencies")', () => {
  it('accepts a valid currency and applies the defaults decimals 2 and active true', () => {
    expect(normalizeCurrencyFields({ name: 'Tether', symbol: '₮' })).toEqual({
      name: 'Tether',
      symbol: '₮',
      decimals: 2,
      active: true,
    });
  });

  it('trims the name and the symbol', () => {
    expect(normalizeCurrencyFields({ name: '  Euro ', symbol: ' € ' })).toMatchObject({
      name: 'Euro',
      symbol: '€',
    });
  });

  it('rejects a bad code (lower case or too short)', () => {
    expect(() => assertCurrencyCode('us')).toThrow(ValidationFailedError);
    expect(fieldErrorsOf(() => assertCurrencyCode('us'))).toEqual({
      code: [CURRENCY_MESSAGES.invalidCurrency],
    });
    expect(() => assertCurrencyCode('USDT')).not.toThrow();
  });

  it('rejects out-of-range decimals', () => {
    expect(
      fieldErrorsOf(() => normalizeCurrencyFields({ name: 'Dollar', symbol: '$', decimals: 9 })),
    ).toEqual({ decimals: [CURRENCY_MESSAGES.tooLarge] });
    expect(
      fieldErrorsOf(() => normalizeCurrencyFields({ name: 'Dollar', symbol: '$', decimals: -1 })),
    ).toEqual({ decimals: [CURRENCY_MESSAGES.tooSmall] });
    expect(
      fieldErrorsOf(() => normalizeCurrencyFields({ name: 'Dollar', symbol: '$', decimals: 1.5 })),
    ).toEqual({ decimals: [CURRENCY_MESSAGES.invalidFormat] });
  });

  it('requires a name and a symbol, reporting every failing field together', () => {
    expect(fieldErrorsOf(() => normalizeCurrencyFields({ name: '  ', symbol: '' }))).toEqual({
      name: [CURRENCY_MESSAGES.required],
      symbol: [CURRENCY_MESSAGES.required],
    });
    expect(
      fieldErrorsOf(() => normalizeCurrencyFields({ name: 'x'.repeat(121), symbol: '$' })),
    ).toEqual({ name: [CURRENCY_MESSAGES.tooLong] });
  });
});

describe('currency change sets', () => {
  it('records a creation as one currency entry', () => {
    expect(currencyCreationChanges('BRL')).toEqual({ currency: [null, 'BRL'] });
  });

  it('records only the fields that changed, with the decimals as strings', () => {
    const changes = currencyChanges(COP, {
      name: 'Peso colombiano',
      symbol: '$',
      decimals: 0,
      active: false,
    });
    expect(changes).toEqual({
      symbol: ['COL$', '$'],
      decimals: ['2', '0'],
      active: [true, false],
    });
  });

  it('returns null when nothing changed, so no activity is written', () => {
    expect(
      currencyChanges(COP, { name: COP.name, symbol: COP.symbol, decimals: 2, active: true }),
    ).toBeNull();
  });
});

describe('currency activation (USD is the reference)', () => {
  it('refuses to deactivate USD with a field error on active', () => {
    expect(fieldErrorsOf(() => assertCurrencyActivation('USD', false))).toEqual({
      active: [CURRENCY_MESSAGES.usdAlwaysActive],
    });
  });

  it('allows deactivating any other currency and keeping USD active', () => {
    expect(() => assertCurrencyActivation('COP', false)).not.toThrow();
    expect(() => assertCurrencyActivation('USD', true)).not.toThrow();
  });
});

describe('currency list order', () => {
  it('puts USD first and orders the rest by code', () => {
    const rows = ['VES', 'USDT', 'USD', 'EUR', 'COP'].map((code) => ({ ...COP, code }));
    expect(sortCurrencies(rows).map((row) => row.code)).toEqual([
      'USD',
      'COP',
      'EUR',
      'USDT',
      'VES',
    ]);
  });
});
