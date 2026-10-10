import Decimal from "decimal.js";

/**
 * Money primitives (PRD §9, C15). Amounts, rates and percentages travel as plain decimal strings
 * ('.' separator, optional leading '-', no thousands separators) and are computed only with
 * decimal.js. Nothing here uses number arithmetic, parseFloat or Number() on money.
 */

/** Isolated decimal.js constructor: ROUND_HALF_UP and enough precision for Decimal(20,8) products. */
export const Money = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type MoneyDecimal = InstanceType<typeof Money>;

/** Amount, rate or percentage as a plain decimal string, e.g. "1234.50". */
export type MoneyString = string;

export const MONEY_DECIMALS = 2;
export const RATE_DECIMALS = 8;
/** An invoice is settled when its balance is at or below this value (PRD §9.5). */
export const SETTLED_THRESHOLD = "0.01";

const PLAIN_DECIMAL = /^-?(\d+(\.\d+)?|\.\d+)$/;

export function isDecimalString(value: unknown): value is MoneyString {
  return typeof value === "string" && PLAIN_DECIMAL.test(value);
}

/** Parses a plain decimal string. Throws on anything else (exponents, separators, blanks, NaN). */
export function toDecimal(value: MoneyString): MoneyDecimal {
  if (!isDecimalString(value)) {
    throw new RangeError(`Invalid decimal string: ${JSON.stringify(value)}`);
  }
  return new Money(value);
}

function fixed(value: MoneyDecimal, decimals: number): MoneyString {
  const out = value.toFixed(decimals, Money.ROUND_HALF_UP);
  // Normalize "-0.00" to "0.00".
  return out.startsWith("-") && new Money(out).isZero() ? out.slice(1) : out;
}

/** Rounds half up to 2 decimals and returns a fixed-scale string. */
export function roundMoney(value: MoneyString): MoneyString {
  return fixed(toDecimal(value), MONEY_DECIMALS);
}

/** Rounds half up to 8 decimals (rates are Decimal(20,8)). */
export function roundRate(value: MoneyString): MoneyString {
  return fixed(toDecimal(value), RATE_DECIMALS);
}

export function sumMoney(values: readonly MoneyString[]): MoneyString {
  let total = new Money(0);
  for (const value of values) total = total.plus(toDecimal(value));
  return fixed(total, MONEY_DECIMALS);
}

export function addMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fixed(toDecimal(a).plus(toDecimal(b)), MONEY_DECIMALS);
}

export function subMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fixed(toDecimal(a).minus(toDecimal(b)), MONEY_DECIMALS);
}

/** round(quantity × unitPrice, 2), the line amount of C17. */
export function mulMoney(a: MoneyString, b: MoneyString): MoneyString {
  return fixed(toDecimal(a).times(toDecimal(b)), MONEY_DECIMALS);
}

/** round(base × rate / 100, 2). Used for VAT, withholdings and fee percentages. */
export function percentOf(base: MoneyString, rate: MoneyString): MoneyString {
  return fixed(toDecimal(base).times(toDecimal(rate)).dividedBy(100), MONEY_DECIMALS);
}

function positiveRate(usdRate: MoneyString): MoneyDecimal {
  const rate = toDecimal(usdRate);
  if (!rate.greaterThan(0)) throw new RangeError("usdRate must be greater than zero");
  return rate;
}

/** amountUsd = round(amount / usdRate, 2) (PRD §9.2). usdRate is units of currency per 1 USD. */
export function toUsd(amount: MoneyString, usdRate: MoneyString): MoneyString {
  return fixed(toDecimal(amount).dividedBy(positiveRate(usdRate)), MONEY_DECIMALS);
}

/** round(amountUsd × usdRate, 2): the proposed amount in the invoice currency (PRD §9.5). */
export function fromUsd(amountUsd: MoneyString, usdRate: MoneyString): MoneyString {
  return fixed(toDecimal(amountUsd).times(positiveRate(usdRate)), MONEY_DECIMALS);
}

/** True when the balance is at or below 0.01 (PRD §9.5). */
export function isSettled(balance: MoneyString): boolean {
  return toDecimal(balance).lessThanOrEqualTo(SETTLED_THRESHOLD);
}

export function compareMoney(a: MoneyString, b: MoneyString): -1 | 0 | 1 {
  return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1;
}

export function isZeroMoney(value: MoneyString): boolean {
  return toDecimal(value).isZero();
}

export function isNegativeMoney(value: MoneyString): boolean {
  return toDecimal(value).isNegative() && !toDecimal(value).isZero();
}

const ISO_CURRENCY_CODE = /^[A-Za-z]{3}$/;

/**
 * Display only: formats the rounded string with Intl.NumberFormat (no number conversion).
 * Codes that are not a 3-letter ISO 4217 code (e.g. `USDT`) make `style: "currency"` throw, so they
 * fall back to a 2-decimal locale number with the code appended.
 */
export function formatMoney(amount: MoneyString, currency: string, locale: string): string {
  const rounded = roundMoney(amount);
  const isIso = ISO_CURRENCY_CODE.test(currency);
  const formatter = new Intl.NumberFormat(locale, {
    ...(isIso ? { style: "currency" as const, currency } : {}),
    minimumFractionDigits: MONEY_DECIMALS,
    maximumFractionDigits: MONEY_DECIMALS,
  });
  const formatted = formatter.format(
    rounded as unknown as Parameters<Intl.NumberFormat["format"]>[0],
  );
  return isIso ? formatted : `${formatted} ${currency}`;
}
