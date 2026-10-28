import { roundMoney, subMoney, sumMoney, toDecimal, type MoneyString } from "@/lib/money";
import {
  DASHBOARD_KPI_ID_VALUES,
  type DashboardKpiId,
  type KpiCardDTO,
  type MonthKey,
} from "@/lib/validators/dashboard";

// Period selector of the dashboard (frontend-patterns §9: Mes / Trimestre / Año). The service answers one month
// (`DashboardQuery.month`), so a quarter or a year is the calendar period to date, aggregated from its months and
// compared with the same months of the previous period. Pure, so the page and the tests share it.

export const DASHBOARD_PERIOD_VALUES = ["month", "quarter", "year"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIOD_VALUES)[number];

const PERIOD_LENGTH: Record<DashboardPeriod, number> = { month: 1, quarter: 3, year: 12 };

/** Flow cards add up over the months; the others are stocks read at the period close. */
const FLOW_KPIS = new Set<DashboardKpiId>([
  "COLLECTED_MONTH",
  "BILLED_MONTH",
  "EXPENSES_MONTH",
  "RESULT_MONTH",
]);
/** Stocks with history in the service (the receivable and the MRR at a month close). */
const COMPARABLE_STOCK_KPIS = new Set<DashboardKpiId>(["RECEIVABLE", "MRR"]);

/** The `?period=` search param, `month` when missing or unknown. */
export function parseDashboardPeriod(value: string | string[] | undefined): DashboardPeriod {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_PERIOD_VALUES.find((period) => period === raw) ?? "month";
}

export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Months of the period to date that ends at `current`, and the same months one period earlier. */
export function periodMonths(
  current: MonthKey,
  period: DashboardPeriod,
): { months: MonthKey[]; previousMonths: MonthKey[] } {
  const length = PERIOD_LENGTH[period];
  const monthIndex = Number(current.slice(5, 7)) - 1;
  const elapsed = (monthIndex % length) + 1;
  const months = Array.from({ length: elapsed }, (_, index) =>
    shiftMonth(current, index - elapsed + 1),
  );
  return { months, previousMonths: months.map((month) => shiftMonth(month, -length)) };
}

function changePercent(value: MoneyString, previous: MoneyString | null): MoneyString | null {
  if (previous === null || toDecimal(previous).isZero()) return null;
  const delta = toDecimal(subMoney(value, previous));
  return roundMoney(delta.times(100).dividedBy(toDecimal(previous).abs()).toFixed());
}

function card(cards: readonly KpiCardDTO[], id: DashboardKpiId): KpiCardDTO {
  const found = cards.find((item) => item.id === id);
  if (!found) throw new Error(`Missing KPI card ${id}`);
  return found;
}

/**
 * The eight cards over a period from the month dashboards of the period (`current`, oldest first) and of the
 * previous period (`previous`, same order): flows are summed, the receivable and the MRR are taken at the last
 * month's close, the accounts balance and the active projects stay as of today without comparison.
 */
export function aggregatePeriodKpis(
  current: readonly (readonly KpiCardDTO[])[],
  previous: readonly (readonly KpiCardDTO[])[],
): KpiCardDTO[] {
  const latest = current.at(-1);
  const latestBefore = previous.at(-1);
  if (!latest || !latestBefore) throw new Error("A period needs at least one month");

  return DASHBOARD_KPI_ID_VALUES.map((id) => {
    const base = card(latest, id);
    if (FLOW_KPIS.has(id)) {
      const value = sumMoney(current.map((cards) => card(cards, id).value));
      const previousValue = sumMoney(previous.map((cards) => card(cards, id).value));
      return { ...base, value, previousValue, changePercent: changePercent(value, previousValue) };
    }
    if (COMPARABLE_STOCK_KPIS.has(id)) {
      const previousValue = card(latestBefore, id).value;
      return { ...base, previousValue, changePercent: changePercent(base.value, previousValue) };
    }
    return { ...base, previousValue: null, changePercent: null };
  });
}
