import { addDays as addDaysFns, differenceInCalendarDays, format as formatFns } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

/**
 * Dates (PRD §6, DT-19, DT-43). Instants are stored in UTC; business dates are date-only strings
 * 'YYYY-MM-DD' (Prisma `@db.Date`). Business "today" is always America/Caracas; the display time
 * zone is a parameter (per-user preference, default Caracas).
 */

export const BUSINESS_TIME_ZONE = "America/Caracas";

/** Date-only value, 'YYYY-MM-DD'. */
export type DateOnly = string;

export type DateStyle = "short" | "medium" | "long";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses 'YYYY-MM-DD' to a Date at 00:00 UTC (what `@db.Date` round-trips). Throws if invalid. */
export function parseDateOnly(value: DateOnly): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new RangeError(`Invalid date-only string: ${JSON.stringify(value)}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return date;
}

/** The calendar day of an instant in the given zone (default Caracas), as 'YYYY-MM-DD'. */
export function toDateOnly(date: Date, timeZone: string = BUSINESS_TIME_ZONE): DateOnly {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

/** Business "today": the Caracas calendar day at `now`, regardless of server or user zone. */
export function todayInCaracas(now: Date): DateOnly {
  return toDateOnly(now, BUSINESS_TIME_ZONE);
}

/** Adds (or subtracts, when negative) calendar days to a date-only value. */
export function addDays(value: DateOnly, days: number): DateOnly {
  return addDaysFns(parseDateOnly(value), days).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return differenceInCalendarDays(parseDateOnly(to), parseDateOnly(from));
}

/** Monday to Friday. Holidays are not modelled. */
export function isBusinessDay(value: DateOnly): boolean {
  const day = parseDateOnly(value).getUTCDay();
  return day !== 0 && day !== 6;
}

const DATE_PATTERNS: Record<"es" | "en", Record<DateStyle, string>> = {
  es: { short: "dd/MM/yyyy", medium: "d MMM yyyy", long: "d 'de' MMMM 'de' yyyy" },
  en: { short: "MM/dd/yyyy", medium: "MMM d, yyyy", long: "MMMM d, yyyy" },
};

const DATE_TIME_PATTERNS: Record<"es" | "en", Record<DateStyle, string>> = {
  es: {
    short: "dd/MM/yyyy HH:mm",
    medium: "d MMM yyyy, HH:mm",
    long: "d 'de' MMMM 'de' yyyy, HH:mm:ss",
  },
  en: {
    short: "MM/dd/yyyy h:mm a",
    medium: "MMM d, yyyy, h:mm a",
    long: "MMMM d, yyyy, h:mm:ss a",
  },
};

function localeKey(locale: string): "es" | "en" {
  return locale.toLowerCase().startsWith("es") ? "es" : "en";
}

function fnsLocale(locale: string) {
  return localeKey(locale) === "es" ? es : enUS;
}

/**
 * Formats a date for display. A date-only string is a calendar day and is never shifted by the
 * zone; a Date is an instant shown in `timeZone` (default Caracas).
 */
export function formatDate(
  value: Date | DateOnly,
  locale: string,
  style: DateStyle = "medium",
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const pattern = DATE_PATTERNS[localeKey(locale)][style];
  if (typeof value === "string") {
    // Re-anchor the calendar day to local fields so no zone can move it.
    const day = parseDateOnly(value);
    const local = new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    return formatFns(local, pattern, { locale: fnsLocale(locale) });
  }
  return formatInTimeZone(value, timeZone, pattern, { locale: fnsLocale(locale) });
}

/** Formats an instant with date and time in `timeZone` (default Caracas). */
export function formatDateTime(
  value: Date,
  locale: string,
  style: DateStyle = "medium",
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return formatInTimeZone(value, timeZone, DATE_TIME_PATTERNS[localeKey(locale)][style], {
    locale: fnsLocale(locale),
  });
}

/** Wall-clock Date in `timeZone` for an instant (UI pickers only; do not store the result). */
export function toZonedDate(value: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  return toZonedTime(value, timeZone);
}
