import Decimal from 'decimal.js';
import { ValidationFailedError } from './domain-error';

/**
 * Money primitive (PRD §9, C15). Amounts travel as plain decimal strings ('.' separator, optional
 * leading '-', no exponents or thousands separators) and are computed only with decimal.js; nothing
 * here uses `number` arithmetic on amounts. Operations keep full precision; `round()` is applied when
 * a value is persisted (ROUND_HALF_UP, 2 decimals by default).
 *
 * Two surfaces over the same decimal.js core: the immutable `Money` class (typed currency) and the
 * string helpers below it (`roundMoney`, `percentOf`, `toUsd`...), which the finance calculators
 * (C17) and the read-model splits use on plain decimal strings.
 */

/** Isolated decimal.js constructor: ROUND_HALF_UP and enough precision for Decimal(20,8) products. */
const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

export const MONEY_DECIMALS = 2;
export const RATE_DECIMALS = 8;
/** An invoice is settled when its balance is at or below this value (PRD §9.5, C17, HU-12 CA3). */
export const SETTLED_THRESHOLD = '0.01';

const PLAIN_DECIMAL = /^-?(\d+(\.\d+)?|\.\d+)$/;
const CURRENCY_CODE = /^[A-Z]{3,5}$/;

export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && PLAIN_DECIMAL.test(value);
}

function parseDecimal(value: unknown, field: string): Decimal {
  if (!isDecimalString(value)) {
    throw new ValidationFailedError({
      message: 'validation.money.invalid',
      fieldErrors: { [field]: ['validation.money.invalid'] },
    });
  }
  return new MoneyDecimal(value);
}

function fixedString(value: Decimal, decimals: number): string {
  const out = value.toFixed(decimals, Decimal.ROUND_HALF_UP);
  // Normalize "-0.00" to "0.00".
  return out.startsWith('-') && new MoneyDecimal(out).isZero() ? out.slice(1) : out;
}

function percentOfDecimal(base: Decimal, rate: Decimal): Decimal {
  return new MoneyDecimal(fixedString(base.times(rate).dividedBy(100), MONEY_DECIMALS));
}

function positiveRate(usdRate: string): Decimal {
  const rate = parseDecimal(usdRate, 'usdRate');
  if (!rate.greaterThan(0)) {
    throw new ValidationFailedError({
      message: 'validation.rate.invalid',
      fieldErrors: { usdRate: ['validation.rate.invalid'] },
    });
  }
  return rate;
}

/** Immutable amount in one currency. */
export class Money {
  private constructor(
    private readonly value: Decimal,
    readonly currency: string,
    /** Fixed scale set by `round()`, so `toString()` keeps trailing zeros ("10.00"). */
    private readonly scale?: number,
  ) {}

  /** `amount` is a plain decimal string; `currency` an uppercase 3-5 letter code (USD, VES, USDT). */
  static of(amount: string, currency: string): Money {
    if (typeof currency !== 'string' || !CURRENCY_CODE.test(currency)) {
      throw new ValidationFailedError({
        message: 'validation.currency.invalid',
        fieldErrors: { currency: ['validation.currency.invalid'] },
      });
    }
    return new Money(parseDecimal(amount, 'amount'), currency);
  }

  static zero(currency: string): Money {
    return Money.of('0', currency);
  }

  static sum(values: readonly Money[], currency: string): Money {
    return values.reduce<Money>((total, next) => total.add(next), Money.zero(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  /** Multiplies by a decimal-string factor (quantity, rate). Not rounded: call `round()` on persist. */
  multiply(factor: string): Money {
    return new Money(this.value.times(parseDecimal(factor, 'factor')), this.currency);
  }

  /** round(this × rate / 100, 2): VAT, withholdings and fee percentages. */
  percentOf(rate: string): Money {
    return new Money(
      percentOfDecimal(this.value, parseDecimal(rate, 'rate')),
      this.currency,
      MONEY_DECIMALS,
    );
  }

  /** round(this / usdRate, 2) as USD; `usdRate` is units of this currency per 1 USD (PRD §9.2). */
  toUsd(usdRate: string): Money {
    return new Money(
      new MoneyDecimal(fixedString(this.value.dividedBy(positiveRate(usdRate)), MONEY_DECIMALS)),
      'USD',
      MONEY_DECIMALS,
    );
  }

  /** round(this × usdRate, 2) in `currency`: a USD amount proposed in another currency (PRD §9.5). */
  fromUsd(currency: string, usdRate: string): Money {
    const converted = this.value.times(positiveRate(usdRate));
    return Money.of(fixedString(converted, MONEY_DECIMALS), currency).round();
  }

  /** True when the balance is at or below 0.01 (PRD §9.5). */
  isSettled(): boolean {
    return this.value.lessThanOrEqualTo(SETTLED_THRESHOLD);
  }

  /** Rounds half up to 8 dp (rates are Decimal(20,8)). */
  roundRate(): Money {
    return this.round(RATE_DECIMALS);
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.value.comparedTo(other.value) as -1 | 0 | 1;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  /** Rounds half up to `decimals` (default 2). `-0` is normalized to zero. */
  round(decimals: number = MONEY_DECIMALS): Money {
    const fixed = this.value.toFixed(decimals, Decimal.ROUND_HALF_UP);
    const normalized = new MoneyDecimal(fixed).isZero() ? fixed.replace('-', '') : fixed;
    return new Money(new MoneyDecimal(normalized), this.currency, decimals);
  }

  /** Plain decimal string. After `round()` it has a fixed scale (`"10.00"`). */
  toString(): string {
    if (this.scale !== undefined) return this.value.toFixed(this.scale);
    return this.value.isZero() ? '0' : this.value.toFixed();
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new ValidationFailedError({
        message: 'validation.currency.invalid',
        fieldErrors: { currency: ['validation.currency.invalid'] },
      });
    }
  }
}

// ───────────────────────── string helpers (plain decimal strings, C15) ─────────────────────────

/** Amount, rate or percentage as a plain decimal string, e.g. "1234.50". */
export type MoneyString = string;

/** Parses a plain decimal string. Throws `RangeError` on anything else (exponents, separators, blanks, NaN). */
export function toDecimal(value: MoneyString): Decimal {
  if (!isDecimalString(value)) {
    throw new RangeError(`Invalid decimal string: ${JSON.stringify(value)}`);
  }
  return new MoneyDecimal(value);
}

function fixed(value: Decimal, decimals: number): MoneyString {
  return fixedString(value, decimals);
}

function positiveRateOrThrow(usdRate: MoneyString): Decimal {
  const rate = toDecimal(usdRate);
  if (!rate.greaterThan(0)) throw new RangeError('usdRate must be greater than zero');
  return rate;
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
  let total = new MoneyDecimal(0);
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

/** amountUsd = round(amount / usdRate, 2) (PRD §9.2). usdRate is units of currency per 1 USD. */
export function toUsd(amount: MoneyString, usdRate: MoneyString): MoneyString {
  return fixed(toDecimal(amount).dividedBy(positiveRateOrThrow(usdRate)), MONEY_DECIMALS);
}

/** round(amountUsd × usdRate, 2): the proposed amount in the invoice currency (PRD §9.5). */
export function fromUsd(amountUsd: MoneyString, usdRate: MoneyString): MoneyString {
  return fixed(toDecimal(amountUsd).times(positiveRateOrThrow(usdRate)), MONEY_DECIMALS);
}

/** True when the balance is at or below 0.01 (PRD §9.5; C17, HU-12 CA3). */
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
 * Display only: formats the rounded string with Intl.NumberFormat (no number conversion). Codes that
 * are not a 3-letter ISO 4217 code (e.g. `USDT`) make `style: "currency"` throw, so they fall back to
 * a 2-decimal locale number with the code appended.
 */
export function formatMoney(amount: MoneyString, currency: string, locale: string): string {
  const rounded = roundMoney(amount);
  const isIso = ISO_CURRENCY_CODE.test(currency);
  const formatter = new Intl.NumberFormat(locale, {
    ...(isIso ? { style: 'currency' as const, currency } : {}),
    minimumFractionDigits: MONEY_DECIMALS,
    maximumFractionDigits: MONEY_DECIMALS,
  });
  const formatted = formatter.format(rounded as `${number}`);
  return isIso ? formatted : `${formatted} ${currency}`;
}
