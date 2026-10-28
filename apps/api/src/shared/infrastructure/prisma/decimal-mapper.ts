import { Prisma } from './generated-client';
import { parseDateOnly, type DateOnly } from '../../domain/business-date';
import { isDecimalString, Money } from '../../domain/money';

/** Prisma `Decimal` -> plain decimal string (no exponent). Never via `number` (C15). */
export function decimalToString(value: Prisma.Decimal): string {
  return value.toFixed();
}

/** Decimal string -> Prisma `Decimal`. Rejects anything that is not a plain decimal string. */
export function stringToDecimal(value: string): Prisma.Decimal {
  if (!isDecimalString(value))
    throw new RangeError(`Invalid decimal string: ${JSON.stringify(value)}`);
  return new Prisma.Decimal(value);
}

export function decimalToMoney(value: Prisma.Decimal, currency: string): Money {
  return Money.of(decimalToString(value), currency);
}

export function moneyToDecimal(money: Money): Prisma.Decimal {
  return stringToDecimal(money.toString());
}

/** `@db.Date` (a `Date` at 00:00 UTC) -> `YYYY-MM-DD`. */
export function dbDateToDateOnly(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> the `Date` Prisma stores in a `@db.Date` column. */
export function dateOnlyToDbDate(value: DateOnly): Date {
  return parseDateOnly(value);
}
