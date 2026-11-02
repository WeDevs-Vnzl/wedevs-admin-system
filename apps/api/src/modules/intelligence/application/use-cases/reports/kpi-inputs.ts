import type { ExchangeRatePort } from '../../../../finance/application/ports/exchange-rate.port';
import type { DateOnly } from '../../../../../shared/domain/business-date';
import { roundMoney, sumMoney, toUsd, type MoneyString } from '../../../../../shared/domain/money';
import {
  monthEnd,
  monthOf,
  monthStart,
  previousPeriod,
  rangeClose,
  shiftMonth,
  type DateRange,
  type MonthKey,
} from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type {
  ClientCollectionDay,
  KpiClientRow,
  KpiProjectRow,
  ProjectFlowRow,
  ReceivableClose,
  RecurringChargeRow,
  RecurringExpenseRow,
  ReportInputsReadPort,
  ReportScope,
} from '../../ports/report-inputs-read.port';

/** Months on the sparkline of a KPI card. */
export const SPARKLINE_MONTHS = 12;
const ZERO = '0.00';

/** The three flows every ratio KPI reads over one window. */
export interface WindowFlows {
  readonly billedUsd: MoneyString;
  readonly collectedUsd: MoneyString;
  readonly expensesUsd: MoneyString;
}

/** What the KPIs read over one window of time. */
export interface KpiWindowData {
  readonly window: DateRange;
  /** The window's last day, or today while it runs. */
  readonly close: DateOnly;
  readonly flows: WindowFlows;
  /** Expenses of the three calendar months ending at the window's last month (the runway input). */
  readonly lastThreeMonthsExpenses: readonly MoneyString[];
  readonly projectFlows: readonly ProjectFlowRow[];
  readonly receivable: ReceivableClose;
}

/**
 * Everything the 18 KPIs read, fetched once for every window they are asked over: the range, the period
 * just before, and the sparkline months (oldest first), plus the inputs that do not depend on a window.
 */
export interface KpiData {
  /** Expense facts carry no client, so figures built on expenses have no answer under a client filter. */
  readonly clientScoped: boolean;
  readonly range: KpiWindowData;
  readonly previous: KpiWindowData;
  readonly months: readonly KpiWindowData[];
  readonly collections: readonly ClientCollectionDay[];
  readonly charges: readonly RecurringChargeRow[];
  readonly recurringExpenses: readonly RecurringExpenseRow[];
  readonly accountsBalanceUsd: MoneyString;
  readonly projects: readonly KpiProjectRow[];
  readonly clients: readonly KpiClientRow[];
}

export interface KpiReaders {
  readonly facts: FinanceFactsReadPort;
  readonly inputs: ReportInputsReadPort;
  readonly rates: ExchangeRatePort;
}

/** The windows of a KPI page: the range, the period before, and the 12 months ending at the range's last. */
export function kpiWindows(range: DateRange): {
  range: DateRange;
  previous: DateRange;
  months: DateRange[];
} {
  const last = monthOf(range.to);
  const months = Array.from({ length: SPARKLINE_MONTHS }, (_, i) =>
    shiftMonth(last, i - SPARKLINE_MONTHS + 1),
  ).map((m) => ({ from: monthStart(m), to: monthEnd(m) }));
  return { range, previous: previousPeriod(range), months };
}

const monthAmounts = (series: { month: MonthKey; amounts: Record<string, MoneyString> }[]) =>
  new Map(series.map((entry) => [entry.month, entry.amounts]));

/** USD value of the live accounts at the latest rate (§8.1); an account in a currency without a rate counts zero. */
async function accountsBalanceUsd(
  inputs: ReportInputsReadPort,
  rates: ExchangeRatePort,
  today: DateOnly,
): Promise<MoneyString> {
  const balances = await inputs.accountBalances();
  const rateOf = new Map<string, MoneyString | null>();
  for (const currency of new Set(balances.map((b) => b.currency))) {
    rateOf.set(currency, (await rates.getRateFor(today, currency))?.usdRate ?? null);
  }
  return sumMoney(
    balances.map((row) => {
      const rate = rateOf.get(row.currency) ?? null;
      return rate === null ? ZERO : toUsd(roundMoney(row.balance), rate);
    }),
  );
}

/**
 * Loads the inputs of all KPIs for the range in a constant number of reads: the facts port gives the range,
 * the period before and one series over the sparkline months (plus the three months before the previous
 * close for its runway); the report-inputs port gives everything else for all windows at once.
 */
export async function loadKpiData(
  { facts, inputs, rates }: KpiReaders,
  range: DateRange,
  scope: ReportScope,
  today: DateOnly,
): Promise<KpiData> {
  const { previous, months } = kpiWindows(range);
  const windows = [range, previous, ...months];
  const last = monthOf(range.to);
  const previousLast = monthOf(previous.to);
  const spanFrom = monthStart(shiftMonth(last, -(SPARKLINE_MONTHS + 1)));
  const closeOf = (window: DateRange) => rangeClose(window, today);
  const closes = [...new Set(windows.map(closeOf))];
  const latest = windows.reduce((max, w) => (w.to > max ? w.to : max), range.to);

  const [
    current,
    before,
    series,
    previousExpenseSeries,
    receivable,
    collections,
    projectFlows,
    charges,
    recurringExpenses,
    balance,
    projects,
    clients,
  ] = await Promise.all([
    facts.sumByKind(range, scope),
    facts.sumByKind(previous, scope),
    facts.monthlySeries(
      { from: spanFrom, to: monthEnd(last) },
      ['BILLED', 'COLLECTED', 'EXPENSE_PAID'],
      scope,
    ),
    facts.monthlySeries(
      { from: monthStart(shiftMonth(previousLast, -2)), to: monthEnd(previousLast) },
      ['EXPENSE_PAID'],
      scope,
    ),
    inputs.receivableAt(closes, scope),
    inputs.collectionsByClientDay(latest, scope),
    inputs.projectFlows(windows, scope),
    inputs.recurringCharges(scope),
    inputs.recurringExpenses(scope),
    accountsBalanceUsd(inputs, rates, today),
    inputs.kpiProjects(scope),
    inputs.kpiClients(scope),
  ]);

  const monthly = monthAmounts(series);
  const previousMonthly = monthAmounts(previousExpenseSeries);
  const lastThree = (source: Map<MonthKey, Record<string, MoneyString>>, month: MonthKey) =>
    [-2, -1, 0].map((delta) => source.get(shiftMonth(month, delta))?.EXPENSE_PAID ?? ZERO);
  const receivableByClose = new Map(receivable.map((row) => [row.close, row]));

  const windowData = (
    window: DateRange,
    index: number,
    flows: WindowFlows,
    expenses: readonly MoneyString[],
  ): KpiWindowData => {
    const close = closeOf(window);
    return {
      window,
      close,
      flows,
      lastThreeMonthsExpenses: expenses,
      projectFlows: projectFlows.filter((row) => row.window === index),
      receivable: receivableByClose.get(close) ?? { close, totalUsd: ZERO, overdueUsd: ZERO },
    };
  };
  const flowsOf = (kinds: { BILLED: string; COLLECTED: string; EXPENSE_PAID: string }) => ({
    billedUsd: kinds.BILLED,
    collectedUsd: kinds.COLLECTED,
    expensesUsd: kinds.EXPENSE_PAID,
  });

  return {
    clientScoped: scope.clientId !== undefined,
    range: windowData(range, 0, flowsOf(current), lastThree(monthly, last)),
    previous: windowData(previous, 1, flowsOf(before), lastThree(previousMonthly, previousLast)),
    months: months.map((window, i) => {
      const month = monthOf(window.from);
      return windowData(
        window,
        i + 2,
        flowsOf({
          BILLED: monthly.get(month)?.BILLED ?? ZERO,
          COLLECTED: monthly.get(month)?.COLLECTED ?? ZERO,
          EXPENSE_PAID: monthly.get(month)?.EXPENSE_PAID ?? ZERO,
        }),
        lastThree(monthly, month),
      );
    }),
    collections,
    charges,
    recurringExpenses,
    accountsBalanceUsd: balance,
    projects,
    clients,
  };
}
