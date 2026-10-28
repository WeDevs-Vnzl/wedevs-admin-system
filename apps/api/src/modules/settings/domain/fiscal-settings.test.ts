import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  DEFAULT_FISCAL_SETTINGS,
  FISCAL_MESSAGES,
  canonicalPercent,
  fiscalChanges,
  fiscalFromStored,
  isAllowedIvaRate,
  normalizeFiscalSettings,
  sameRate,
  type FiscalSettings,
} from './fiscal-settings';

function fieldErrorsOf(action: () => unknown): Record<string, string[]> {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationFailedError) return error.fieldErrors ?? {};
    throw error;
  }
  return {};
}

describe('fiscal settings defaults (DT-44)', () => {
  it('defaults to rates 16/8/0, default 16, IGTF 3 and 15 due days', () => {
    expect(normalizeFiscalSettings({})).toEqual(DEFAULT_FISCAL_SETTINGS);
    expect(DEFAULT_FISCAL_SETTINGS).toEqual({
      ivaRates: ['16', '8', '0'],
      ivaDefaultRate: '16',
      igtfRate: '3',
      igtfCurrencies: [],
      invoiceDefaultDueDays: 15,
    });
  });

  it('accepts custom rates and IGTF currencies, without any method code list (DT-70)', () => {
    const parsed = normalizeFiscalSettings({
      ivaRates: ['16', '0'],
      ivaDefaultRate: '0',
      igtfCurrencies: ['USD', 'EUR'],
    });
    expect(parsed).toMatchObject({
      ivaRates: ['16', '0'],
      ivaDefaultRate: '0',
      igtfCurrencies: ['USD', 'EUR'],
    });
    expect(parsed).not.toHaveProperty('igtfMethodCodes');
  });
});

describe('fiscal settings rules', () => {
  it('rejects a default rate outside the allowed list', () => {
    expect(
      fieldErrorsOf(() => normalizeFiscalSettings({ ivaRates: ['16', '0'], ivaDefaultRate: '8' })),
    ).toEqual({ ivaDefaultRate: [FISCAL_MESSAGES.defaultIvaRateNotAllowed] });
  });

  it('rejects an empty list, numerically repeated rates, and rates out of range or badly formed', () => {
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ ivaRates: [] }))).toEqual({
      ivaRates: [FISCAL_MESSAGES.required],
    });
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ ivaRates: ['16', '16.00'] }))).toEqual({
      'ivaRates.1': [FISCAL_MESSAGES.duplicateIvaRate],
    });
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ ivaRates: ['16', '101'] }))).toEqual({
      'ivaRates.1': [FISCAL_MESSAGES.percentOutOfRange],
    });
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ igtfRate: 'abc' }))).toEqual({
      igtfRate: [FISCAL_MESSAGES.invalidPercent],
    });
  });

  it('bounds the due days to 0 through 365 integer days', () => {
    expect(normalizeFiscalSettings({ invoiceDefaultDueDays: 30 }).invoiceDefaultDueDays).toBe(30);
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ invoiceDefaultDueDays: -1 }))).toEqual({
      invoiceDefaultDueDays: [FISCAL_MESSAGES.tooSmall],
    });
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ invoiceDefaultDueDays: 366 }))).toEqual({
      invoiceDefaultDueDays: [FISCAL_MESSAGES.tooLarge],
    });
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ invoiceDefaultDueDays: 1.5 }))).toEqual({
      invoiceDefaultDueDays: [FISCAL_MESSAGES.invalidFormat],
    });
  });

  it('rejects an IGTF currency code that is not a currency shape', () => {
    expect(fieldErrorsOf(() => normalizeFiscalSettings({ igtfCurrencies: ['us'] }))).toEqual({
      'igtfCurrencies.0': [FISCAL_MESSAGES.invalidCurrency],
    });
  });

  it('keeps the canonical decimal string of every rate (strings, never numbers, C15)', () => {
    const parsed = normalizeFiscalSettings({
      ivaRates: ['16.00', '8.5', '0'],
      ivaDefaultRate: '16.0',
      igtfRate: '3.50',
    });
    expect(parsed).toMatchObject({
      ivaRates: ['16', '8.5', '0'],
      ivaDefaultRate: '16',
      igtfRate: '3.5',
    });
  });
});

describe('percent comparison', () => {
  it('compares rates numerically', () => {
    expect(sameRate('16', '16.00')).toBe(true);
    expect(sameRate('16', '8')).toBe(false);
    expect(sameRate('abc', '16')).toBe(false);
    expect(isAllowedIvaRate('8.00', ['16', '8', '0'])).toBe(true);
    expect(isAllowedIvaRate('12', ['16', '8', '0'])).toBe(false);
  });

  it('classifies a percent: shape, range and decimals, in that order', () => {
    expect(canonicalPercent('100.00')).toEqual({ ok: true, value: '100' });
    expect(canonicalPercent('0')).toEqual({ ok: true, value: '0' });
    expect(canonicalPercent('100.5')).toEqual({
      ok: false,
      key: FISCAL_MESSAGES.percentOutOfRange,
    });
    expect(canonicalPercent('1.555')).toEqual({
      ok: false,
      key: FISCAL_MESSAGES.percentTooManyDecimals,
    });
    expect(canonicalPercent('-1')).toEqual({ ok: false, key: FISCAL_MESSAGES.invalidPercent });
    expect(canonicalPercent('1e2')).toEqual({ ok: false, key: FISCAL_MESSAGES.invalidPercent });
  });
});

describe('fiscal change sets', () => {
  it('records one change set over the parameters, and nothing when nothing changed', () => {
    const next: FiscalSettings = { ...DEFAULT_FISCAL_SETTINGS, invoiceDefaultDueDays: 30 };
    expect(fiscalChanges(DEFAULT_FISCAL_SETTINGS, next)).toEqual({
      invoiceDefaultDueDays: ['15', '30'],
    });
    expect(fiscalChanges(DEFAULT_FISCAL_SETTINGS, { ...DEFAULT_FISCAL_SETTINGS })).toBeNull();
  });
});

describe('fiscal reads from the Setting row', () => {
  it('reads the defaults when the row is missing', () => {
    expect(fiscalFromStored(undefined)).toEqual(DEFAULT_FISCAL_SETTINGS);
  });

  it('ignores the stale igtfMethodCodes key of the seed (DT-70)', () => {
    const seeded = {
      ivaRates: ['16', '8', '0'],
      ivaDefaultRate: '16',
      igtfRate: '3',
      igtfCurrencies: ['USD', 'EUR', 'USDT'],
      igtfMethodCodes: ['ZELLE'],
      invoiceDefaultDueDays: 15,
    };
    expect(fiscalFromStored(seeded)).toEqual({
      ivaRates: ['16', '8', '0'],
      ivaDefaultRate: '16',
      igtfRate: '3',
      igtfCurrencies: ['USD', 'EUR', 'USDT'],
      invoiceDefaultDueDays: 15,
    });
  });

  it('reads the defaults for a value that is not a well-formed fiscal record', () => {
    expect(fiscalFromStored('nope')).toEqual(DEFAULT_FISCAL_SETTINGS);
    expect(fiscalFromStored({ ivaRates: [16, 8] })).toEqual(DEFAULT_FISCAL_SETTINGS);
    expect(fiscalFromStored({ ivaRates: ['16'], ivaDefaultRate: '8' })).toEqual(
      DEFAULT_FISCAL_SETTINGS,
    );
  });
});
