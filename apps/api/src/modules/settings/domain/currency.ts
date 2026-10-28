import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';

/**
 * Currency catalog (PRD §8.15, §10.2 `Currency`). Ported from the currency part of
 * `fe/src/lib/validators/catalogs.ts` and `fe/src/mocks/services/catalogs.ts`. Pure: no framework, no
 * clock. Currencies are never deleted (C19): a retired currency is deactivated, which hides it from pickers
 * and keeps every record that points at it readable.
 */

/** USD is the reference of every rate (PRD §9.2): it always exists and stays active. */
export const USD_CODE = 'USD';

/** ISO 4217 or a token such as `USDT` (FE `currencyCodeSchema`, `Currency.code`). */
export const CURRENCY_CODE_PATTERN = /^[A-Z][A-Z0-9]{2,9}$/;

export const CURRENCY_LIMITS = {
  name: 120,
  symbol: 8,
  decimalsMin: 0,
  decimalsMax: 8,
  decimalsDefault: 2,
} as const;

/** i18n keys the currency rules return (namespace `catalogs` for the catalog errors, `validation` for shape). */
export const CURRENCY_MESSAGES = {
  codeTaken: 'catalogs.currencies.errors.codeTaken',
  usdAlwaysActive: 'catalogs.currencies.errors.usdAlwaysActive',
  invalidCurrency: 'validation.currency.invalid',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidFormat: 'validation.invalidFormat',
  tooSmall: 'validation.tooSmall',
  tooLarge: 'validation.tooLarge',
} as const;

/** Fields compared for the `SETTINGS_CHANGE` activity of an update. The code is the key and never changes. */
export const CURRENCY_CHANGE_FIELDS = ['name', 'symbol', 'decimals', 'active'] as const;

export type Currency = {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly active: boolean;
};

/** The editable part of a currency (everything but the code). */
export type CurrencyFields = {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly active: boolean;
};

/** What a caller sends. Omitted `decimals` is 2 and omitted `active` is true. */
export type CurrencyFieldsInput = {
  readonly name: string;
  readonly symbol: string;
  readonly decimals?: number | undefined;
  readonly active?: boolean | undefined;
};

/** Trims a required text; records the field error and returns the trimmed text either way. */
function requiredText(value: string, max: number, field: string, errors: FieldErrors): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) (errors[field] ??= []).push(CURRENCY_MESSAGES.required);
  else if (trimmed.length > max) (errors[field] ??= []).push(CURRENCY_MESSAGES.tooLong);
  return trimmed;
}

/** A code of the wrong shape is a validation error on create. */
export function assertCurrencyCode(code: string): void {
  if (!CURRENCY_CODE_PATTERN.test(code)) {
    throw new ValidationFailedError({ fieldErrors: { code: [CURRENCY_MESSAGES.invalidCurrency] } });
  }
}

/** Validates and normalizes the editable fields; every failing field is reported together. */
export function normalizeCurrencyFields(input: CurrencyFieldsInput): CurrencyFields {
  const errors: FieldErrors = {};
  const name = requiredText(input.name, CURRENCY_LIMITS.name, 'name', errors);
  const symbol = requiredText(input.symbol, CURRENCY_LIMITS.symbol, 'symbol', errors);

  const decimals = input.decimals ?? CURRENCY_LIMITS.decimalsDefault;
  if (!Number.isInteger(decimals)) errors.decimals = [CURRENCY_MESSAGES.invalidFormat];
  else if (decimals < CURRENCY_LIMITS.decimalsMin) errors.decimals = [CURRENCY_MESSAGES.tooSmall];
  else if (decimals > CURRENCY_LIMITS.decimalsMax) errors.decimals = [CURRENCY_MESSAGES.tooLarge];

  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
  return { name, symbol, decimals, active: input.active ?? true };
}

/** USD can never be deactivated (PRD §9.2). */
export function assertCurrencyActivation(code: string, active: boolean): void {
  if (code === USD_CODE && !active) {
    throw new ValidationFailedError({
      fieldErrors: { active: [CURRENCY_MESSAGES.usdAlwaysActive] },
    });
  }
}

/** USD first, then the other codes in code order (the catalog has no stored sort column). */
export function sortCurrencies(rows: readonly Currency[]): Currency[] {
  const rank = (code: string): number => (code === USD_CODE ? 0 : 1);
  return [...rows].sort(
    (a, b) => rank(a.code) - rank(b.code) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  );
}

/** The `SETTINGS_CHANGE` change set of an update, or `null` when nothing changed. */
export function currencyChanges(before: Currency, after: CurrencyFields): ActivityChanges | null {
  return diffFields(before, after, { fields: CURRENCY_CHANGE_FIELDS });
}

/** The `SETTINGS_CHANGE` change set of a creation: the code, from nothing. */
export function currencyCreationChanges(code: string): ActivityChanges {
  return { currency: [null, code] };
}
