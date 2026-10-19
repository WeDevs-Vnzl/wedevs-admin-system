import { daysBetween, parseDateOnly, type DateOnly } from "@/lib/dates";
import { mulMoney, roundMoney, sumMoney, toDecimal, type MoneyString } from "@/lib/money";
import type { Frequency, ProjectStatus, RecurringStatus } from "@/lib/validators/enums";

import { normalizeToMonth } from "./recurring";

// KPI formulas of PRD §8.13.2 (HU-31). Every amount is USD from the stored snapshots (C16): they are
// summed, never converted with today's rate. Percentages are 0–100 with 2 decimals; days and months
// have 2 decimals. A ratio whose denominator is zero (or that has no data) returns `null`, never
// NaN or Infinity, so the card shows "no data" (`KpiResultDTO.value`).

/** Inclusive date range of the KPI page filter. */
export type KpiPeriod = { from: DateOnly; to: DateOnly };

/** A recurring charge or a recurring expense, with its amount in USD. */
export type KpiRecurringItem = {
  amountUsd: MoneyString;
  frequency: Frequency;
  status: RecurringStatus;
};

/** Projects with these statuses are "active" (§8.1, "Proyectos activos"). */
const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ["EN_CURSO", "MANTENIMIENTO"];

function inPeriod(date: DateOnly | null, period: KpiPeriod): date is DateOnly {
  return date !== null && date >= period.from && date <= period.to;
}

/** round(numerator × 100 ÷ denominator, 2), or `null` when the denominator is not positive. */
function percent(numerator: MoneyString, denominator: MoneyString): MoneyString | null {
  const base = toDecimal(denominator);
  if (!base.greaterThan(0)) return null;
  return roundMoney(toDecimal(numerator).times(100).dividedBy(base).toFixed());
}

/** round(total ÷ count, 2), or `null` for no items. */
function average(total: MoneyString, count: number): MoneyString | null {
  if (count === 0) return null;
  return roundMoney(toDecimal(total).dividedBy(count).toFixed());
}

function sumActiveMonthly(items: readonly KpiRecurringItem[]): MoneyString {
  return sumMoney(
    items
      .filter((item) => item.status === "ACTIVO")
      .map((item) => normalizeToMonth(item.amountUsd, item.frequency)),
  );
}

/** MRR: Σ active recurring charges normalized to a month (quarterly ÷ 3, half-yearly ÷ 6, yearly ÷ 12). */
export function computeMrr(charges: readonly KpiRecurringItem[]): MoneyString {
  return sumActiveMonthly(charges);
}

/** ARR: MRR × 12. */
export function computeArr(mrrUsd: MoneyString): MoneyString {
  return mulMoney(mrrUsd, "12");
}

/** DSO: (receivable at the close ÷ billed in the period) × days of the period. */
export function computeDso(input: {
  receivableUsd: MoneyString;
  billedUsd: MoneyString;
  period: KpiPeriod;
}): MoneyString | null {
  const billed = toDecimal(input.billedUsd);
  if (!billed.greaterThan(0)) return null;
  const days = daysBetween(input.period.from, input.period.to) + 1;
  return roundMoney(toDecimal(input.receivableUsd).dividedBy(billed).times(days).toFixed());
}

/** Collection rate: collected in the period ÷ billed in the period. */
export function computeCollectionRate(input: {
  collectedUsd: MoneyString;
  billedUsd: MoneyString;
}): MoneyString | null {
  return percent(input.collectedUsd, input.billedUsd);
}

/** Delinquency: overdue balance ÷ total receivable. */
export function computeDelinquency(input: {
  overdueUsd: MoneyString;
  receivableUsd: MoneyString;
}): MoneyString | null {
  return percent(input.overdueUsd, input.receivableUsd);
}

/** Project margin: (collected − expenses charged to the project) ÷ collected. */
export function computeProjectMargin(input: {
  collectedUsd: MoneyString;
  allocatedExpensesUsd: MoneyString;
}): MoneyString | null {
  const margin = toDecimal(input.collectedUsd).minus(toDecimal(input.allocatedExpensesUsd));
  return percent(margin.toFixed(), input.collectedUsd);
}

/** Operating margin: (collected − total expenses) ÷ collected. */
export function computeOperatingMargin(input: {
  collectedUsd: MoneyString;
  expensesUsd: MoneyString;
}): MoneyString | null {
  const margin = toDecimal(input.collectedUsd).minus(toDecimal(input.expensesUsd));
  return percent(margin.toFixed(), input.collectedUsd);
}

/** Fixed monthly expense: Σ active recurring expenses normalized to a month. */
export function computeFixedMonthlyExpense(expenses: readonly KpiRecurringItem[]): MoneyString {
  return sumActiveMonthly(expenses);
}

/**
 * Runway in months: accounts balance (USD, latest rate, §8.1) ÷ the average monthly expense of the
 * last 3 months. Pass one total per month, months without expenses as "0.00".
 */
export function computeRunway(input: {
  accountsBalanceUsd: MoneyString;
  lastThreeMonthsExpensesUsd: readonly MoneyString[];
}): MoneyString | null {
  const monthly = average(
    sumMoney(input.lastThreeMonthsExpensesUsd),
    input.lastThreeMonthsExpensesUsd.length,
  );
  if (monthly === null || !toDecimal(monthly).greaterThan(0)) return null;
  return roundMoney(toDecimal(input.accountsBalanceUsd).dividedBy(toDecimal(monthly)).toFixed());
}

/** A confirmed payment allocation, attributed to the client of its invoice. */
export type KpiClientCollection = { clientId: string; amountUsd: MoneyString };

function collectedByClient(
  allocations: readonly KpiClientCollection[],
): { clientId: string; totalUsd: MoneyString }[] {
  const totals = new Map<string, MoneyString[]>();
  for (const allocation of allocations) {
    const amounts = totals.get(allocation.clientId) ?? [];
    amounts.push(allocation.amountUsd);
    totals.set(allocation.clientId, amounts);
  }
  return [...totals]
    .map(([clientId, amounts]) => ({ clientId, totalUsd: sumMoney(amounts) }))
    .sort((a, b) => toDecimal(b.totalUsd).comparedTo(toDecimal(a.totalUsd)));
}

/** The same day 12 months earlier; the window is (that day, asOf]. */
function twelveMonthsBefore(asOf: DateOnly): DateOnly {
  const date = parseDateOnly(asOf);
  return new Date(Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** Revenue concentration: % of the last 12 months collected that comes from the top 1 and top 3 clients. */
export function computeRevenueConcentration(
  allocations: readonly (KpiClientCollection & { date: DateOnly })[],
  asOf: DateOnly,
): { top1: MoneyString | null; top3: MoneyString | null } {
  const start = twelveMonthsBefore(asOf);
  const ranking = collectedByClient(
    allocations.filter((allocation) => allocation.date > start && allocation.date <= asOf),
  );
  const total = sumMoney(ranking.map((client) => client.totalUsd));
  const topShare = (count: number) =>
    percent(sumMoney(ranking.slice(0, count).map((client) => client.totalUsd)), total);
  return { top1: topShare(1), top3: topShare(3) };
}

/**
 * Average project ticket: mean contracted value of the projects started in the period. Projects
 * without a contracted value (no billing plan) are left out.
 */
export function computeAvgProjectTicket(
  projects: readonly { startDate: DateOnly | null; contractedUsd: MoneyString | null }[],
  period: KpiPeriod,
): MoneyString | null {
  const values = projects
    .filter((project) => inPeriod(project.startDate, period))
    .flatMap((project) => (project.contractedUsd === null ? [] : [project.contractedUsd]));
  return average(sumMoney(values), values.length);
}

/**
 * LTV: historical collected per client, highest first, plus its average over the clients given.
 * Include a "0.00" allocation for a client that should count without collections.
 */
export function computeClientLtv(allocations: readonly KpiClientCollection[]): {
  perClient: { clientId: string; ltvUsd: MoneyString }[];
  averageUsd: MoneyString | null;
} {
  const ranking = collectedByClient(allocations);
  return {
    perClient: ranking.map((client) => ({ clientId: client.clientId, ltvUsd: client.totalUsd })),
    averageUsd: average(sumMoney(ranking.map((client) => client.totalUsd)), ranking.length),
  };
}

/** New clients: clients that became `ACTIVO` in the period. */
export function countNewClients(
  clients: readonly { activatedAt: DateOnly | null }[],
  period: KpiPeriod,
): number {
  return clients.filter((client) => inPeriod(client.activatedAt, period)).length;
}

/**
 * Prospect conversion: of the prospects created in the period, the share that became `ACTIVO` by its
 * end (a cohort, so it never exceeds 100 %).
 */
export function computeProspectConversion(
  prospects: readonly { createdAt: DateOnly; activatedAt: DateOnly | null }[],
  period: KpiPeriod,
): MoneyString | null {
  const created = prospects.filter((prospect) => inPeriod(prospect.createdAt, period));
  const converted = created.filter(
    (prospect) => prospect.activatedAt !== null && prospect.activatedAt <= period.to,
  );
  return percent(String(converted.length), String(created.length));
}

/** A project for the delivery KPIs; `deliveredDate` is the actual delivery. */
export type KpiDeliveredProject = {
  startDate: DateOnly | null;
  estimatedEndDate: DateOnly | null;
  deliveredDate: DateOnly | null;
};

/** Average project duration in days: mean of (actual delivery − start) of the delivered projects. */
export function computeAvgProjectDuration(
  projects: readonly KpiDeliveredProject[],
): MoneyString | null {
  const days = projects.flatMap((project) =>
    project.startDate !== null && project.deliveredDate !== null
      ? [daysBetween(project.startDate, project.deliveredDate)]
      : [],
  );
  return average(String(days.reduce((total, value) => total + value, 0)), days.length);
}

/**
 * On-time projects: % of the delivered projects delivered on or before their estimated date.
 * Delivered projects without an estimated date are left out.
 */
export function computeOnTimeProjects(
  projects: readonly KpiDeliveredProject[],
): MoneyString | null {
  const measurable = projects.filter(
    (project) => project.deliveredDate !== null && project.estimatedEndDate !== null,
  );
  const onTime = measurable.filter(
    (project) => project.deliveredDate! <= project.estimatedEndDate!,
  );
  return percent(String(onTime.length), String(measurable.length));
}

/** Stack usage: number of projects per technology, most used first (ties by technology). */
export function computeStackUsage(
  projects: readonly { technologies: readonly string[] }[],
): { technology: string; projects: number }[] {
  const counts = new Map<string, number>();
  for (const project of projects) {
    for (const technology of new Set(project.technologies)) {
      counts.set(technology, (counts.get(technology) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([technology, count]) => ({ technology, projects: count }))
    .sort((a, b) => b.projects - a.projects || a.technology.localeCompare(b.technology));
}

/** Document coverage: % of active projects with a `FIRMADO` contract and a current NDA. */
export function computeDocumentCoverage(
  projects: readonly {
    status: ProjectStatus;
    hasSignedContract: boolean;
    hasCurrentNda: boolean;
  }[],
): MoneyString | null {
  const active = projects.filter((project) => ACTIVE_PROJECT_STATUSES.includes(project.status));
  const covered = active.filter((project) => project.hasSignedContract && project.hasCurrentNda);
  return percent(String(covered.length), String(active.length));
}
