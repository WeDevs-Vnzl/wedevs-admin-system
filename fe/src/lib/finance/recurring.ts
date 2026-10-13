import { addDays, parseDateOnly, type DateOnly } from "@/lib/dates";
import { roundMoney, toDecimal, type MoneyString } from "@/lib/money";
import type { Frequency, RecurringStatus } from "@/lib/validators/enums";

const MONTHS_PER_PERIOD: Record<Frequency, number> = {
  MENSUAL: 1,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12,
};

export type RecurringSchedule = {
  frequency: Frequency;
  startDate: DateOnly;
  endDate: DateOnly | null;
  /** 1 to 28, so every month has it. */
  billingDay: number;
  leadDays: number;
  status: RecurringStatus;
};

export type RecurringPeriod = {
  periodStart: DateOnly;
  periodEnd: DateOnly;
  /** The day the daily job creates the period: `periodStart − leadDays`. */
  generateOn: DateOnly;
};

function dateOf(year: number, monthIndex: number, day: number): DateOnly {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function addMonths(value: DateOnly, months: number, day: number): DateOnly {
  const date = parseDateOnly(value);
  return dateOf(date.getUTCFullYear(), date.getUTCMonth() + months, day);
}

/** First billing date on or after the start date. */
function firstPeriodStart(schedule: RecurringSchedule): DateOnly {
  const start = parseDateOnly(schedule.startDate);
  const sameMonth = dateOf(start.getUTCFullYear(), start.getUTCMonth(), schedule.billingDay);
  return sameMonth >= schedule.startDate ? sameMonth : addMonths(sameMonth, 1, schedule.billingDay);
}

/**
 * The period the daily job must create today, if any (§8.4.3, HU-10, HU-17). Only the period after
 * the last existing one is considered, so skipped periods are not back-filled, and a period that
 * already exists is never returned again (idempotent). Paused or finished schedules generate nothing.
 */
export function dueRecurringPeriods(
  schedule: RecurringSchedule,
  existingPeriodStarts: readonly DateOnly[],
  today: DateOnly,
): RecurringPeriod[] {
  if (schedule.status !== "ACTIVO") return [];
  const step = MONTHS_PER_PERIOD[schedule.frequency];
  const last = [...existingPeriodStarts].sort().at(-1);
  const periodStart = last
    ? addMonths(last, step, schedule.billingDay)
    : firstPeriodStart(schedule);
  if (schedule.endDate !== null && periodStart > schedule.endDate) return [];
  const generateOn = addDays(periodStart, -schedule.leadDays);
  if (generateOn > today) return [];
  const periodEnd = addDays(addMonths(periodStart, step, schedule.billingDay), -1);
  return [{ periodStart, periodEnd, generateOn }];
}

/** Monthly equivalent of a recurring amount (§8.13.2: quarterly ÷ 3, half-yearly ÷ 6, yearly ÷ 12). */
export function normalizeToMonth(amount: MoneyString, frequency: Frequency): MoneyString {
  return roundMoney(toDecimal(amount).dividedBy(MONTHS_PER_PERIOD[frequency]).toString());
}
