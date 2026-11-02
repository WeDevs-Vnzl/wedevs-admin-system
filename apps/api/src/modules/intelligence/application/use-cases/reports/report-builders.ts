import {
  addMoney,
  compareMoney,
  subMoney,
  sumMoney,
  type MoneyString,
} from '../../../../../shared/domain/money';
import { computeProjectMargin, percent } from '../../../../finance/application/kpi-api';
import { monthsOf, rangeClose, type MonthKey } from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type { ReportInputsReadPort, TaxesByMonth } from '../../ports/report-inputs-read.port';
import type {
  AgingBucketsOutput,
  ChartSeriesOutput,
  IvaByRateOutput,
  ReportOutput,
  ReportId,
  TaxesPeriodOutput,
} from './report-types';
import { byteOrder, entityRefs, type ResolvedReportFilter } from './report-support';

const ZERO = '0.00';

export interface ReportDeps {
  readonly facts: FinanceFactsReadPort;
  readonly inputs: ReportInputsReadPort;
}

/** `part` as a percentage of `total`, two decimals; `'0.00'` for an empty total. */
function share(part: MoneyString, total: MoneyString): MoneyString {
  return percent(part, total) ?? ZERO;
}

const largestFirst = (a: MoneyString, b: MoneyString) => compareMoney(b, a);

function emptyTaxes(): TaxesPeriodOutput {
  return {
    ivaByRate: [],
    ivaTotal: ZERO,
    ivaWithheld: ZERO,
    islrWithheld: ZERO,
    otherWithheld: ZERO,
    igtf: ZERO,
  };
}

/** Rates highest first, as the mock listed them. */
function taxesOf(
  rates: TaxesByMonth['rates'],
  withholdings: TaxesByMonth['withholdings'],
): TaxesPeriodOutput {
  const byRate = new Map<string, { base: MoneyString[]; iva: MoneyString[] }>();
  for (const row of rates) {
    const entry = byRate.get(row.ivaRate) ?? { base: [], iva: [] };
    entry.base.push(row.taxBaseUsd);
    entry.iva.push(row.ivaAmountUsd);
    byRate.set(row.ivaRate, entry);
  }
  const ivaByRate: IvaByRateOutput[] = [...byRate]
    .map(([ivaRate, entry]) => ({
      ivaRate,
      taxBase: sumMoney(entry.base),
      ivaAmount: sumMoney(entry.iva),
    }))
    .sort((a, b) => compareMoney(b.ivaRate, a.ivaRate));
  return {
    ivaByRate,
    ivaTotal: sumMoney(ivaByRate.map((row) => row.ivaAmount)),
    ivaWithheld: sumMoney(withholdings.map((row) => row.ivaWithheldUsd)),
    islrWithheld: sumMoney(withholdings.map((row) => row.islrWithheldUsd)),
    otherWithheld: sumMoney(withholdings.map((row) => row.otherWithheldUsd)),
    igtf: sumMoney(withholdings.map((row) => row.igtfUsd)),
  };
}

/** Builds the report `id` for the resolved filter; every read is a port call, every formula is the finance one. */
export async function buildReport(
  { facts, inputs }: ReportDeps,
  id: ReportId,
  filter: ResolvedReportFilter,
): Promise<ReportOutput> {
  const { range, scope, today } = filter;
  const base = {
    currency: 'USD' as const,
    range: { dateFrom: range.from, dateTo: range.to },
  };
  const periods = monthsOf(range);
  // Expense facts carry no client, so figures built on expenses have no answer under a client filter.
  const clientScoped = scope.clientId !== undefined;

  switch (id) {
    case 'COLLECTED_BY_MONTH': {
      const months = await facts.monthlySeries(range, ['COLLECTED'], scope);
      return {
        ...base,
        reportId: id,
        points: months.map((m) => ({ period: m.month, value: m.amounts.COLLECTED })),
      };
    }
    case 'BILLED_VS_COLLECTED': {
      const months = await facts.monthlySeries(range, ['BILLED', 'COLLECTED'], scope);
      return {
        ...base,
        reportId: id,
        chart: {
          periods,
          series: [
            { id: 'billed', values: months.map((m) => m.amounts.BILLED) },
            { id: 'collected', values: months.map((m) => m.amounts.COLLECTED) },
          ],
        },
      };
    }
    case 'REVENUE_BY_CLIENT': {
      const groups = await facts.sumBy('client', range, ['COLLECTED', 'BILLED'], scope);
      const refOf = await entityRefs(
        inputs,
        'CLIENT',
        groups.map((g) => g.key),
      );
      const rows = groups.map((group) => ({
        client: refOf(group.key),
        collected: group.amounts.COLLECTED,
        billed: group.amounts.BILLED,
      }));
      rows.sort(
        (a, b) =>
          largestFirst(a.collected, b.collected) ||
          largestFirst(a.billed, b.billed) ||
          byteOrder(a.client.id, b.client.id),
      );
      return { ...base, reportId: id, rows };
    }
    case 'REVENUE_BY_PROJECT': {
      const groups = await facts.sumBy('project', range, ['COLLECTED', 'EXPENSE_PAID'], scope);
      const refOf = await entityRefs(
        inputs,
        'PROJECT',
        groups.map((g) => g.key),
      );
      const rows = groups.map((group) => ({
        project: refOf(group.key),
        collected: group.amounts.COLLECTED,
        margin: clientScoped ? null : subMoney(group.amounts.COLLECTED, group.amounts.EXPENSE_PAID),
        marginPercent: clientScoped
          ? null
          : computeProjectMargin({
              collectedUsd: group.amounts.COLLECTED,
              allocatedExpensesUsd: group.amounts.EXPENSE_PAID,
            }),
      }));
      rows.sort(
        (a, b) =>
          largestFirst(a.collected, b.collected) ||
          largestFirst(a.margin ?? '0.00', b.margin ?? '0.00') ||
          byteOrder(a.project.id, b.project.id),
      );
      return { ...base, reportId: id, rows };
    }
    case 'RECEIVABLES_AGING': {
      const aging = await facts.agingAt(rangeClose(range, today), scope);
      const refOf = await entityRefs(
        inputs,
        'CLIENT',
        aging.rows.map((row) => row.clientId),
      );
      const rows = aging.rows.map((row) => ({
        client: refOf(row.clientId),
        buckets: row.buckets as AgingBucketsOutput,
        total: row.totalUsd,
      }));
      return { ...base, reportId: id, rows, totals: aging.totals };
    }
    case 'EXPENSES_BY_MONTH_CATEGORY': {
      const rows = await inputs.expensesByMonthCategory(range, scope);
      const perCategory = new Map<string, Map<MonthKey, MoneyString>>();
      for (const row of rows) {
        const months = perCategory.get(row.categoryId) ?? new Map<MonthKey, MoneyString>();
        months.set(row.month, addMoney(months.get(row.month) ?? ZERO, row.amountUsd));
        perCategory.set(row.categoryId, months);
      }
      const ids = [...perCategory.keys()];
      const labels = new Map(
        (ids.length === 0 ? [] : await inputs.labels('CATEGORY', ids)).map((row) => [
          row.id,
          row.label,
        ]),
      );
      const series: (ChartSeriesOutput & { total: MoneyString })[] = ids.map((categoryId) => {
        const values = periods.map((month) => perCategory.get(categoryId)?.get(month) ?? ZERO);
        return {
          id: categoryId,
          label: labels.get(categoryId) ?? categoryId,
          values,
          total: sumMoney(values),
        };
      });
      series.sort(
        (a, b) =>
          largestFirst(a.total, b.total) ||
          byteOrder(a.label ?? '', b.label ?? '') ||
          byteOrder(a.id, b.id),
      );
      return {
        ...base,
        reportId: id,
        chart: { periods, series: series.map(({ total: _total, ...rest }) => rest) },
      };
    }
    case 'NET_RESULT_MONTHLY': {
      const months = await facts.monthlySeries(range, ['COLLECTED', 'EXPENSE_PAID'], scope);
      return {
        ...base,
        reportId: id,
        points: months.map((m) => ({
          period: m.month,
          value: clientScoped ? null : subMoney(m.amounts.COLLECTED, m.amounts.EXPENSE_PAID),
        })),
      };
    }
    case 'ACCOUNT_FLOW': {
      const flows = await inputs.accountFlow(range, scope);
      const refOf = await entityRefs(inputs, 'ACCOUNT', [
        ...new Set(flows.map((f) => f.accountId)),
      ]);
      const rows = flows.map((flow) => ({
        account: refOf(flow.accountId),
        period: flow.month,
        inflow: flow.inflowUsd,
        outflow: flow.outflowUsd,
      }));
      rows.sort(
        (a, b) =>
          byteOrder(a.period, b.period) ||
          byteOrder(a.account.label, b.account.label) ||
          byteOrder(a.account.id, b.account.id),
      );
      return { ...base, reportId: id, rows };
    }
    case 'COLLECTIONS_BY_METHOD': {
      const groups = await facts.sumBy('method', range, ['COLLECTED'], scope);
      const codes = new Map(
        (groups.length === 0
          ? []
          : await inputs.labels(
              'METHOD',
              groups.map((g) => g.key),
            )
        ).map((row) => [row.id, row.code ?? row.label]),
      );
      const total = sumMoney(groups.map((g) => g.amounts.COLLECTED));
      const rows = groups.map((group) => ({
        methodId: group.key,
        methodCode: codes.get(group.key) ?? group.key,
        collected: group.amounts.COLLECTED,
        share: share(group.amounts.COLLECTED, total),
      }));
      rows.sort(
        (a, b) => largestFirst(a.collected, b.collected) || byteOrder(a.methodId, b.methodId),
      );
      return { ...base, reportId: id, rows };
    }
    case 'TAXES_REGISTERED': {
      const taxes = await inputs.taxesByMonth(range, scope);
      const months = periods.map((period) => ({
        period,
        ...(taxes.rates.some((r) => r.month === period) ||
        taxes.withholdings.some((w) => w.month === period)
          ? taxesOf(
              taxes.rates.filter((r) => r.month === period),
              taxes.withholdings.filter((w) => w.month === period),
            )
          : emptyTaxes()),
      }));
      return {
        ...base,
        reportId: id,
        months,
        totals: taxesOf(taxes.rates, taxes.withholdings),
      };
    }
  }
}
