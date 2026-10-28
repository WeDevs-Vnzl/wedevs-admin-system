import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Fiscal parameters (PRD §8.15, §9.8; DT-44, DT-70). Ported from the fiscal part of
 * `fe/src/lib/validators/settings.ts` and `updateFiscalSettings` of `fe/src/mocks/services/catalogs.ts`.
 * Pure: no framework, no clock. The values are stored configuration: percentages and amounts travel as
 * decimal strings (C15); the tax calculations that use them are BE-3.
 *
 * IGTF has a single source (DT-70): the currencies in `igtfCurrencies`. The `igtfMethodCodes` list of the FE
 * draft is gone; a stored row that still carries it is read without it.
 */

/** The `Setting` key that stores the fiscal parameters (PRD §10.2). */
export const FISCAL_SETTING_KEY = 'fiscal';

/** Entity id and label of the `SETTINGS_CHANGE` activity of the fiscal parameters. */
export const FISCAL_ACTIVITY_ID = 'fiscal';

export const DEFAULT_IVA_RATES = ['16', '8', '0'] as const;
export const DEFAULT_IVA_RATE = '16';
export const DEFAULT_IGTF_RATE = '3';
export const DEFAULT_INVOICE_DUE_DAYS = 15;

export const FISCAL_LIMITS = {
  ivaRatesMax: 10,
  igtfCurrenciesMax: 20,
  dueDaysMin: 0,
  dueDaysMax: 365,
} as const;

/** Fields compared for the `SETTINGS_CHANGE` activity of the fiscal parameters. */
export const FISCAL_CHANGE_FIELDS = [
  'ivaRates',
  'ivaDefaultRate',
  'igtfRate',
  'igtfCurrencies',
  'invoiceDefaultDueDays',
] as const;

/** i18n keys (namespace `settings` for the fiscal rules, `validation` for the shape). */
export const FISCAL_MESSAGES = {
  duplicateIvaRate: 'settings.validation.duplicateIvaRate',
  defaultIvaRateNotAllowed: 'settings.validation.defaultIvaRateNotAllowed',
  invalidPercent: 'validation.percent.invalid',
  percentOutOfRange: 'validation.percent.outOfRange',
  percentTooManyDecimals: 'validation.percent.tooManyDecimals',
  invalidCurrency: 'validation.currency.invalid',
  unknownCurrency: 'catalogs.rates.errors.unknownCurrency',
  required: 'validation.required',
  invalidFormat: 'validation.invalidFormat',
  tooSmall: 'validation.tooSmall',
  tooLarge: 'validation.tooLarge',
} as const;

export type FiscalSettings = {
  /** Allowed VAT rates for invoice lines, canonical decimal strings, unique. */
  readonly ivaRates: readonly string[];
  /** Preselected rate of a new line; one of `ivaRates`. */
  readonly ivaDefaultRate: string;
  readonly igtfRate: string;
  /** Currencies that propose IGTF on a payment (DT-70). */
  readonly igtfCurrencies: readonly string[];
  /** Days added to the issue date to get the default due date (DT-44). */
  readonly invoiceDefaultDueDays: number;
};

/** What a caller sends. Every omitted field takes its default (the FE input contract). */
export type FiscalSettingsInput = {
  readonly ivaRates?: readonly string[] | undefined;
  readonly ivaDefaultRate?: string | undefined;
  readonly igtfRate?: string | undefined;
  readonly igtfCurrencies?: readonly string[] | undefined;
  readonly invoiceDefaultDueDays?: number | undefined;
};

export const DEFAULT_FISCAL_SETTINGS: FiscalSettings = {
  ivaRates: [...DEFAULT_IVA_RATES],
  ivaDefaultRate: DEFAULT_IVA_RATE,
  igtfRate: DEFAULT_IGTF_RATE,
  igtfCurrencies: [],
  invoiceDefaultDueDays: DEFAULT_INVOICE_DUE_DAYS,
};

/** A percentage: its canonical decimal string, or the i18n key of why it is not one. */
export type PercentCheck =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly key: string };

const PERCENT_SHAPE = /^\d+(?:\.\d+)?$/;
const CURRENCY_SHAPE = /^[A-Z][A-Z0-9]{2,9}$/;

/**
 * Checks a percentage in 0 to 100 with at most 2 decimals (FE `percentSchema`) and returns its canonical
 * form: no leading zeros, no trailing fraction zeros (`"16.00"` is `"16"`). Checks run in the order shape,
 * range, decimals.
 */
export function canonicalPercent(value: string): PercentCheck {
  if (typeof value !== 'string' || !PERCENT_SHAPE.test(value)) {
    return { ok: false, key: FISCAL_MESSAGES.invalidPercent };
  }
  const [rawInteger = '0', rawFraction = ''] = value.split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  const inRange = integer.length <= 2 || (integer === '100' && /^0*$/.test(rawFraction));
  if (!inRange) return { ok: false, key: FISCAL_MESSAGES.percentOutOfRange };
  if (rawFraction.length > 2) return { ok: false, key: FISCAL_MESSAGES.percentTooManyDecimals };
  const fraction = rawFraction.replace(/0+$/, '');
  return { ok: true, value: fraction.length > 0 ? `${integer}.${fraction}` : integer };
}

/** Numeric equality of two percentages (`"16"` equals `"16.00"`); a malformed one is never equal. */
export function sameRate(a: string, b: string): boolean {
  const left = canonicalPercent(a);
  const right = canonicalPercent(b);
  return left.ok && right.ok && left.value === right.value;
}

/** True when `rate` is one of `allowed`, compared numerically. */
export function isAllowedIvaRate(rate: string, allowed: readonly string[]): boolean {
  return allowed.some((candidate) => sameRate(rate, candidate));
}

/**
 * Validates and normalizes the fiscal parameters. Every failing field is reported together; the default rate
 * must be one of the allowed rates (DT-44). Currency codes are checked for shape here; that they exist in the
 * catalog is the use case's check.
 */
export function normalizeFiscalSettings(input: FiscalSettingsInput): FiscalSettings {
  const errors: FieldErrors = {};
  const rawRates = input.ivaRates ?? DEFAULT_FISCAL_SETTINGS.ivaRates;
  const rates: string[] = [];

  if (rawRates.length === 0) errors.ivaRates = [FISCAL_MESSAGES.required];
  else if (rawRates.length > FISCAL_LIMITS.ivaRatesMax)
    errors.ivaRates = [FISCAL_MESSAGES.tooLarge];
  rawRates.forEach((rate, index) => {
    const field = `ivaRates.${index}`;
    const check = canonicalPercent(rate);
    if (!check.ok) (errors[field] ??= []).push(check.key);
    else if (rates.includes(check.value))
      (errors[field] ??= []).push(FISCAL_MESSAGES.duplicateIvaRate);
    else rates.push(check.value);
  });

  const defaultCheck = canonicalPercent(input.ivaDefaultRate ?? DEFAULT_IVA_RATE);
  let ivaDefaultRate = DEFAULT_IVA_RATE;
  if (!defaultCheck.ok) errors.ivaDefaultRate = [defaultCheck.key];
  else {
    ivaDefaultRate = defaultCheck.value;
    if (errors.ivaRates === undefined && !rates.includes(ivaDefaultRate)) {
      errors.ivaDefaultRate = [FISCAL_MESSAGES.defaultIvaRateNotAllowed];
    }
  }

  const igtfCheck = canonicalPercent(input.igtfRate ?? DEFAULT_IGTF_RATE);
  let igtfRate = DEFAULT_IGTF_RATE;
  if (!igtfCheck.ok) errors.igtfRate = [igtfCheck.key];
  else igtfRate = igtfCheck.value;

  const currencies = input.igtfCurrencies ?? [];
  if (currencies.length > FISCAL_LIMITS.igtfCurrenciesMax) {
    errors.igtfCurrencies = [FISCAL_MESSAGES.tooLarge];
  }
  currencies.forEach((code, index) => {
    if (!CURRENCY_SHAPE.test(code))
      (errors[`igtfCurrencies.${index}`] ??= []).push(FISCAL_MESSAGES.invalidCurrency);
  });

  const dueDays = input.invoiceDefaultDueDays ?? DEFAULT_INVOICE_DUE_DAYS;
  if (!Number.isInteger(dueDays)) errors.invoiceDefaultDueDays = [FISCAL_MESSAGES.invalidFormat];
  else if (dueDays < FISCAL_LIMITS.dueDaysMin)
    errors.invoiceDefaultDueDays = [FISCAL_MESSAGES.tooSmall];
  else if (dueDays > FISCAL_LIMITS.dueDaysMax)
    errors.invoiceDefaultDueDays = [FISCAL_MESSAGES.tooLarge];

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return {
    ivaRates: rates,
    ivaDefaultRate,
    igtfRate,
    igtfCurrencies: [...currencies],
    invoiceDefaultDueDays: dueDays,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const integerValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;

/**
 * Reads the stored `fiscal` value. A missing or malformed row reads as the defaults, so the settings screen
 * and the portal never break on it. Unknown keys (the old `igtfMethodCodes` of the seed, DT-70) are ignored.
 */
export function fiscalFromStored(stored: unknown): FiscalSettings {
  if (!isRecord(stored)) return { ...DEFAULT_FISCAL_SETTINGS, ivaRates: [...DEFAULT_IVA_RATES] };
  try {
    return normalizeFiscalSettings({
      ivaRates: stringArray(stored.ivaRates),
      ivaDefaultRate: stringValue(stored.ivaDefaultRate),
      igtfRate: stringValue(stored.igtfRate),
      igtfCurrencies: stringArray(stored.igtfCurrencies),
      invoiceDefaultDueDays: integerValue(stored.invoiceDefaultDueDays),
    });
  } catch (error) {
    if (error instanceof ValidationFailedError) {
      return { ...DEFAULT_FISCAL_SETTINGS, ivaRates: [...DEFAULT_IVA_RATES] };
    }
    throw error;
  }
}

/** The `SETTINGS_CHANGE` change set between two sets of parameters, or `null` when nothing changed. */
export function fiscalChanges(
  before: FiscalSettings,
  after: FiscalSettings,
): ActivityChanges | null {
  return diffFields(before, after, { fields: FISCAL_CHANGE_FIELDS });
}
