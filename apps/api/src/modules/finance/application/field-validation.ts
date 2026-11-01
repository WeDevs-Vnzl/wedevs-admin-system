import { isValidDateOnly } from '../../../shared/domain/business-date';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';
import { compareMoney, isDecimalString, toDecimal } from '../../../shared/domain/money';

/**
 * Field validation shared by the finance slices (expenses, payments): the i18n keys of the shape rules and
 * the helpers that collect them into `FieldErrors`. Enforced in the use case, never only in the DTO (lesson B2).
 */
export const SHAPE_MESSAGES = {
  usdRateMustBeOne: 'catalogs.validation.usdRateMustBeOne',
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  invalidDate: 'validation.date.invalid',
  invalidMoney: 'validation.money.invalid',
  moneyMustBePositive: 'validation.money.mustBePositive',
  moneyTooManyDecimals: 'validation.money.tooManyDecimals',
  moneyOutOfRange: 'validation.money.outOfRange',
  invalidRate: 'validation.rate.invalid',
  rateMustBePositive: 'validation.rate.mustBePositive',
  rateTooManyDecimals: 'validation.rate.tooManyDecimals',
  rateOutOfRange: 'validation.rate.outOfRange',
  invalidOption: 'validation.invalidOption',
} as const;

export function addError(errors: FieldErrors, path: string, key: string): void {
  errors[path] = [...(errors[path] ?? []), key];
}

export function dateError(errors: FieldErrors, path: string, value: unknown): value is string {
  if (typeof value === 'string' && isValidDateOnly(value)) return true;
  addError(errors, path, SHAPE_MESSAGES.invalidDate);
  return false;
}

/** A money amount: decimal string, at most 2 decimals, 16 integer digits (`Decimal(18,2)`), strictly positive. */
export function moneyError(errors: FieldErrors, path: string, value: unknown): void {
  if (!isDecimalString(value) || value.startsWith('-')) {
    addError(errors, path, SHAPE_MESSAGES.invalidMoney);
  } else if (!/^(?:0|[1-9]\d{0,15})(?:\.\d+)?$/.test(value)) {
    addError(errors, path, SHAPE_MESSAGES.moneyOutOfRange);
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    addError(errors, path, SHAPE_MESSAGES.moneyTooManyDecimals);
  } else if (toDecimal(value).isZero()) {
    addError(errors, path, SHAPE_MESSAGES.moneyMustBePositive);
  }
}

/** A rate: decimal string > 0, at most 8 decimals and 12 integer digits (`Decimal(20,8)`). */
export function rateError(errors: FieldErrors, path: string, value: unknown): boolean {
  if (!isDecimalString(value) || value.startsWith('-')) {
    addError(errors, path, SHAPE_MESSAGES.invalidRate);
  } else if (!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(value)) {
    addError(errors, path, SHAPE_MESSAGES.rateOutOfRange);
  } else if (!/^\d+(?:\.\d{1,8})?$/.test(value)) {
    addError(errors, path, SHAPE_MESSAGES.rateTooManyDecimals);
  } else if (toDecimal(value).isZero()) {
    addError(errors, path, SHAPE_MESSAGES.rateMustBePositive);
  } else {
    return true;
  }
  return false;
}

/** USD is the reference currency: its rate is exactly 1. */
export function usdRateError(errors: FieldErrors, currency: string, usdRate: string): void {
  if (!rateError(errors, 'usdRate', usdRate)) return;
  if (currency === 'USD' && compareMoney(usdRate, '1') !== 0) {
    addError(errors, 'usdRate', SHAPE_MESSAGES.usdRateMustBeOne);
  }
}

export function textError(
  errors: FieldErrors,
  path: string,
  value: unknown,
  max: number,
  required: boolean,
): void {
  if (value === undefined || value === null) {
    if (required) addError(errors, path, SHAPE_MESSAGES.required);
    return;
  }
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    addError(errors, path, SHAPE_MESSAGES.required);
  } else if (value.trim().length > max) {
    addError(errors, path, SHAPE_MESSAGES.tooLong);
  }
}

export function throwIfAny(errors: FieldErrors): void {
  if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
}

/** `VALIDATION` on one field with one i18n key. */
export function invalid(field: string, key: string): ValidationFailedError {
  return new ValidationFailedError({ fieldErrors: { [field]: [key] } });
}
