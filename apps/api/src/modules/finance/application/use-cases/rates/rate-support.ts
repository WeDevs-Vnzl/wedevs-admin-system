import { isValidDateOnly } from '../../../../../shared/domain/business-date';
import type { FieldErrors } from '../../../../../shared/domain/domain-error';
import type { ListQuery, SortSpec } from '../../../../../shared/domain/list-query';
import type { RateSource } from '../../../../../shared/domain/enums';
import { RATE_SOURCE_VALUES } from '../../../../../shared/domain/enums';
import type { ExchangeRateFilter } from '../../ports/exchange-rate.repository.port';

/** i18n keys of the rate rules (namespace `catalogs`; shape keys come from `validation`). */
export const RATE_MESSAGES = {
  unknownCurrency: 'catalogs.rates.errors.unknownCurrency',
  currencyIsUsd: 'catalogs.validation.rateCurrencyIsUsd',
  duplicateCurrency: 'catalogs.validation.duplicateRateCurrency',
  invalidCurrency: 'validation.currency.invalid',
  invalidDate: 'validation.date.invalid',
  invalidRate: 'validation.rate.invalid',
  rateTooManyDecimals: 'validation.rate.tooManyDecimals',
  rateOutOfRange: 'validation.rate.outOfRange',
  rateMustBePositive: 'validation.rate.mustBePositive',
  required: 'validation.required',
} as const;

export const EXCHANGE_RATE_SORT_FIELDS = [
  'date',
  'currency',
  'usdRate',
  'source',
  'createdAt',
] as const;

export const DEFAULT_RATE_SORT: SortSpec = { field: 'date', direction: 'desc' };

/** Rows one CSV import accepts (the FE `MAX_RATE_CSV_ROWS`) and rates one daily load accepts. */
export const MAX_IMPORT_ROWS = 2000;
export const MAX_DAILY_RATES = 50;

const CURRENCY_CODE = /^[A-Z][A-Z0-9]{2,9}$/;
const RATE_SHAPE = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const RATE_RANGE = /^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/; // Decimal(20, 8)
const RATE_DECIMALS = /^\d+(?:\.\d{1,8})?$/;
const ZERO = /^0(?:\.0+)?$/;

/** Message keys for a date-only string, or none when it is a real calendar date. */
export function dateErrors(date: unknown): string[] {
  return typeof date === 'string' && isValidDateOnly(date) ? [] : [RATE_MESSAGES.invalidDate];
}

/** Shape of a currency code asked about (lookup, filters): no catalog access. */
export function currencyCodeErrors(code: unknown): string[] {
  return typeof code === 'string' && CURRENCY_CODE.test(code)
    ? []
    : [RATE_MESSAGES.invalidCurrency];
}

/** A currency a rate can be stored for: a well-formed code that is not USD (USD is the reference). */
export function rateCurrencyErrors(code: unknown): string[] {
  const shape = currencyCodeErrors(code);
  if (shape.length > 0) return shape;
  return code === 'USD' ? [RATE_MESSAGES.currencyIsUsd] : [];
}

/** A rate as a plain decimal string: > 0, at most 8 decimals and 12 integer digits (`Decimal(20,8)`). */
export function usdRateErrors(value: unknown): string[] {
  if (typeof value !== 'string' || !RATE_SHAPE.test(value)) return [RATE_MESSAGES.invalidRate];
  if (!RATE_RANGE.test(value)) return [RATE_MESSAGES.rateOutOfRange];
  if (!RATE_DECIMALS.test(value)) return [RATE_MESSAGES.rateTooManyDecimals];
  return ZERO.test(value) ? [RATE_MESSAGES.rateMustBePositive] : [];
}

export function isRateSource(value: unknown): value is RateSource {
  return (RATE_SOURCE_VALUES as readonly unknown[]).includes(value);
}

/** Adds `messages` to `errors[path]` when there are any. */
export function addErrors(errors: FieldErrors, path: string, messages: readonly string[]): void {
  if (messages.length > 0) errors[path] = [...(errors[path] ?? []), ...messages];
}

/** Maps the list query of the route to the repository filter; the DTO already shaped every value. */
export function toRateFilter(query: ListQuery): ExchangeRateFilter {
  const many = (name: string): string[] | undefined => {
    const value = query.filters[name];
    if (value === undefined) return undefined;
    return typeof value === 'string' ? [value] : [...value];
  };
  const one = (name: string): string | undefined => many(name)?.[0];
  const sources = many('source');
  const currencies = many('currency');
  const dateFrom = one('dateFrom');
  const dateTo = one('dateTo');
  return {
    ...(currencies ? { currency: currencies } : {}),
    ...(sources ? { source: sources.filter(isRateSource) } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    sort: query.sort ?? DEFAULT_RATE_SORT,
    page: query.page,
    pageSize: query.pageSize,
  };
}
