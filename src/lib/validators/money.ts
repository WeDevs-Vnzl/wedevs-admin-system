import { z } from "./zod";
import { VALIDATION_MESSAGES } from "./common";

/**
 * Money contracts (C15, PRD §9.1). Amounts, rates and percentages are **decimal strings** in every DTO
 * and input; there is no `z.number()` here on purpose. Arithmetic belongs to `lib/money` (decimal.js).
 *
 * Canonical form accepted: optional `-`, integer part without leading zeros, optional `.` + digits. No
 * `+`, spaces, exponents, thousands separators or bare `.5` / `5.`.
 */

const INTEGER_PART = "(?:0|[1-9]\\d*)";

function isZeroString(value: string): boolean {
  return /^-?0(?:\.0+)?$/.test(value);
}

// ───────────────────────────── Amounts: Decimal(18, 2) ─────────────────────────────

export type MoneySign = "positive" | "nonNegative" | "any";

export interface MoneyAmountOptions {
  /**
   * `positive` (> 0, the default and the strictest), `nonNegative` (≥ 0: discounts, withholdings) or
   * `any` (signed: adjustments, balances).
   */
  sign?: MoneySign;
}

const AMOUNT_SHAPE = new RegExp(`^-?${INTEGER_PART}(?:\\.\\d+)?$`);
const AMOUNT_RANGE = /^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/; // up to 16 integer digits (Decimal(18, 2))
const AMOUNT_DECIMALS = /^-?\d+(?:\.\d{1,2})?$/;

export function moneyAmountSchema(options: MoneyAmountOptions = {}) {
  const sign: MoneySign = options.sign ?? "positive";
  return z.string().superRefine((value, ctx) => {
    if (!AMOUNT_SHAPE.test(value) || (value.startsWith("-") && isZeroString(value))) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.invalidMoney });
      return;
    }
    if (!AMOUNT_RANGE.test(value)) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.moneyOutOfRange });
      return;
    }
    if (!AMOUNT_DECIMALS.test(value)) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.moneyTooManyDecimals });
      return;
    }
    if (sign === "positive" && (value.startsWith("-") || isZeroString(value))) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.moneyMustBePositive });
    } else if (sign === "nonNegative" && value.startsWith("-")) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.moneyMustBeNonNegative });
    }
  });
}

// ───────────────────────────── Rates: Decimal(20, 8) ─────────────────────────────

const RATE_SHAPE = new RegExp(`^${INTEGER_PART}(?:\\.\\d+)?$`);
const RATE_RANGE = /^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/; // up to 12 integer digits (Decimal(20, 8))
const RATE_DECIMALS = /^\d+(?:\.\d{1,8})?$/;

/** Exchange rate: units of the currency per 1 USD. Strictly greater than 0, at most 8 decimals. */
export const rateSchema = z.string().superRefine((value, ctx) => {
  if (!RATE_SHAPE.test(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.invalidRate });
    return;
  }
  if (!RATE_RANGE.test(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.rateOutOfRange });
    return;
  }
  if (!RATE_DECIMALS.test(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.rateTooManyDecimals });
    return;
  }
  if (isZeroString(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.rateMustBePositive });
  }
});

// ───────────────────────────── Percentages: Decimal(5, 2) ─────────────────────────────

const PERCENT_SHAPE = new RegExp(`^${INTEGER_PART}(?:\\.\\d+)?$`);
const PERCENT_IN_RANGE = /^(?:100(?:\.0+)?|(?:0|[1-9]\d?)(?:\.\d+)?)$/; // 0 … 100
const PERCENT_DECIMALS = /^\d+(?:\.\d{1,2})?$/;

/** Percentage 0–100 with at most 2 decimals. Also used for VAT rates (`"16"`, `"8"`, `"0"`). */
export const percentSchema = z.string().superRefine((value, ctx) => {
  if (!PERCENT_SHAPE.test(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.invalidPercent });
    return;
  }
  if (!PERCENT_IN_RANGE.test(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.percentOutOfRange });
    return;
  }
  if (!PERCENT_DECIMALS.test(value)) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.percentTooManyDecimals });
  }
});

// ───────────────────────────── Currency and DTOs ─────────────────────────────

/** Currency catalog code: ISO 4217 or a token such as `USDT` (PRD §10.2 `Currency.code`). */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9]{2,9}$/, VALIDATION_MESSAGES.invalidCurrency);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

/** An amount in a currency, both as strings. Signed values are allowed (balances, adjustments). */
export const moneyDtoSchema = z.object({
  amount: moneyAmountSchema({ sign: "any" }),
  currency: currencyCodeSchema,
});
export type MoneyDTO = z.infer<typeof moneyDtoSchema>;
