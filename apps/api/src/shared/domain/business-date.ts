/**
 * Business dates (PRD §6, DT-19, DT-43). Instants are UTC; business dates are date-only strings
 * 'YYYY-MM-DD' (Prisma `@db.Date`). Business "today" is always America/Caracas. Implemented with
 * `Intl` only: the domain imports no date library and never reads the system clock.
 */

export const BUSINESS_TIME_ZONE = 'America/Caracas';

/** Date-only value, 'YYYY-MM-DD'. */
export type DateOnly = string;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** True for a `YYYY-MM-DD` that is a real calendar date. */
export function isValidDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Parses 'YYYY-MM-DD' to a Date at 00:00 UTC (what `@db.Date` round-trips). Throws if invalid. */
export function parseDateOnly(value: DateOnly): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new RangeError(`Invalid date-only string: ${JSON.stringify(value)}`);
  if (!isValidDateOnly(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** The calendar day of an instant in the given zone (default Caracas), as 'YYYY-MM-DD'. */
export function toDateOnly(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): DateOnly {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year').padStart(4, '0')}-${pick('month')}-${pick('day')}`;
}

/** Business "today": the Caracas calendar day at `now`, regardless of server or user zone. */
export function todayInCaracas(now: Date): DateOnly {
  return toDateOnly(now, BUSINESS_TIME_ZONE);
}

/** Adds (or subtracts, when negative) calendar days to a date-only value. Pure UTC arithmetic. */
export function addDays(value: DateOnly, days: number): DateOnly {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). Pure UTC arithmetic. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return (parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / MS_PER_DAY;
}

/** Monday to Friday. Holidays are not modelled. */
export function isBusinessDay(value: DateOnly): boolean {
  const day = parseDateOnly(value).getUTCDay();
  return day !== 0 && day !== 6;
}
