import Decimal from 'decimal.js';
import { ValidationFailedError } from './domain-error';

/**
 * Money primitive (PRD §9, C15). Amounts travel as plain decimal strings ('.' separator, optional
 * leading '-', no exponents or thousands separators) and are computed only with decimal.js; nothing
 * here uses `number` arithmetic on amounts. Operations keep full precision; `round()` is applied when
 * a value is persisted (ROUND_HALF_UP, 2 decimals by default).
 *
 * `percentOf`, `toUsd`, `fromUsd`, `isSettled`, `roundRate` and rate handling arrive in BE-3.
 */

/** Isolated decimal.js constructor: ROUND_HALF_UP and enough precision for Decimal(20,8) products. */
const MoneyDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});

export const MONEY_DECIMALS = 2;

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
