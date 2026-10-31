import { z } from 'zod';
import { GENERIC_VALIDATION_MESSAGES } from './zod-validation';

/**
 * Shared contract primitives (C8, C15): ids, date-only strings, timestamps and decimal strings for
 * money and rates. Messages are i18n keys, never prose. Ported from `fe/src/lib/validators/common.ts`
 * and `money.ts` (read only).
 */

export const VALIDATION_MESSAGES = {
  ...GENERIC_VALIDATION_MESSAGES,
  invalidId: 'validation.id.invalid',
  invalidDate: 'validation.date.invalid',
  invalidSort: 'validation.sort.invalid',
  invalidMoney: 'validation.money.invalid',
  moneyTooManyDecimals: 'validation.money.tooManyDecimals',
  moneyOutOfRange: 'validation.money.outOfRange',
  moneyMustBePositive: 'validation.money.mustBePositive',
  moneyMustBeNonNegative: 'validation.money.mustBeNonNegative',
  invalidRate: 'validation.rate.invalid',
  rateTooManyDecimals: 'validation.rate.tooManyDecimals',
  rateMustBePositive: 'validation.rate.mustBePositive',
  rateOutOfRange: 'validation.rate.outOfRange',
} as const;

export type ValidationMessageKey = (typeof VALIDATION_MESSAGES)[keyof typeof VALIDATION_MESSAGES];

/** Entity id: opaque string (cuid). Never trusted without a lookup (C14). */
export const idSchema = z
  .string()
  .min(1, VALIDATION_MESSAGES.required)
  .max(64, VALIDATION_MESSAGES.invalidId)
  .regex(/^[A-Za-z0-9_-]+$/, VALIDATION_MESSAGES.invalidId);

/** `YYYY-MM-DD` that is a real calendar date. Business dates are date-only strings. */
export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const dateOnlySchema = z
  .string()
  .refine(isValidDateOnly, { message: VALIDATION_MESSAGES.invalidDate });

/** ISO 8601 UTC timestamp (`2026-10-09T14:30:00.000Z`). Strict: no offsets. */
export const timestampSchema = z.iso.datetime({ message: VALIDATION_MESSAGES.invalidDate });

const INTEGER_PART = '(?:0|[1-9]\\d*)';

/**
 * The decimal-string shape of money and rates, for the OpenAPI document only: the schemas that carry it
 * enforce their rules in `superRefine` and answer with i18n keys, so the pattern is `.meta()` (no runtime
 * check, no change to any error code or message). Responses use the same shape through `decimalStringSchema`.
 */
export const DECIMAL_STRING_PATTERN = '^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$';

/** A request money or rate field that is validated elsewhere (use case) but still documents its shape. */
export const decimalRequestSchema = z.string().meta({ pattern: DECIMAL_STRING_PATTERN });

function isZeroString(value: string): boolean {
  return /^-?0(?:\.0+)?$/.test(value);
}

export type MoneySign = 'positive' | 'nonNegative' | 'any';

export interface MoneyAmountOptions {
  /** `positive` (> 0, default), `nonNegative` (>= 0) or `any` (signed). */
  readonly sign?: MoneySign;
}

const AMOUNT_SHAPE = new RegExp(`^-?${INTEGER_PART}(?:\\.\\d+)?$`);
const AMOUNT_RANGE = /^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/; // Decimal(18, 2)
const AMOUNT_DECIMALS = /^-?\d+(?:\.\d{1,2})?$/;

/** Money amount as a decimal string, at most 2 decimals (C15). */
export function moneyAmountSchema(options: MoneyAmountOptions = {}) {
  const sign: MoneySign = options.sign ?? 'positive';
  return z
    .string()
    .superRefine((value, ctx) => {
      if (!AMOUNT_SHAPE.test(value) || (value.startsWith('-') && isZeroString(value))) {
        ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.invalidMoney });
        return;
      }
      if (!AMOUNT_RANGE.test(value)) {
        ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.moneyOutOfRange });
        return;
      }
      if (!AMOUNT_DECIMALS.test(value)) {
        ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.moneyTooManyDecimals });
        return;
      }
      if (sign === 'positive' && (value.startsWith('-') || isZeroString(value))) {
        ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.moneyMustBePositive });
      } else if (sign === 'nonNegative' && value.startsWith('-')) {
        ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.moneyMustBeNonNegative });
      }
    })
    .meta({ pattern: DECIMAL_STRING_PATTERN });
}

const RATE_SHAPE = new RegExp(`^${INTEGER_PART}(?:\\.\\d+)?$`);
const RATE_RANGE = /^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/; // Decimal(20, 8)
const RATE_DECIMALS = /^\d+(?:\.\d{1,8})?$/;

/** Exchange rate as a decimal string: strictly greater than 0, at most 8 decimals. */
export const rateSchema = z
  .string()
  .superRefine((value, ctx) => {
    if (!RATE_SHAPE.test(value)) {
      ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.invalidRate });
      return;
    }
    if (!RATE_RANGE.test(value)) {
      ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.rateOutOfRange });
      return;
    }
    if (!RATE_DECIMALS.test(value)) {
      ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.rateTooManyDecimals });
      return;
    }
    if (isZeroString(value)) {
      ctx.addIssue({ code: 'custom', message: VALIDATION_MESSAGES.rateMustBePositive });
    }
  })
  .meta({ pattern: DECIMAL_STRING_PATTERN });

/**
 * Output side of money and rates: a decimal string (`"1250.00"`, `"-3.5"`). The `pattern` makes every
 * finance DTO emit `type: string` with a pattern in the OpenAPI document, never `number`. Serializes
 * Prisma `Decimal` values only after the adapter mapped them to strings (C15).
 */
export const decimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);

/** Flattens a Zod error into `fieldErrors` keyed by dotted path (`""` -> `_form`). */
export function zodFieldErrors(error: {
  issues: readonly z.core.$ZodIssue[];
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
