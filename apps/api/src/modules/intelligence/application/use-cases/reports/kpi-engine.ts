import type { DateOnly } from '../../../../../shared/domain/business-date';
import { compareMoney, sumMoney, type MoneyString } from '../../../../../shared/domain/money';
import {
  computeArr,
  computeAvgProjectDuration,
  computeAvgProjectTicket,
  computeClientLtv,
  computeCollectionRate,
  computeDelinquency,
  computeDocumentCoverage,
  computeDso,
  computeFixedMonthlyExpense,
  computeMrr,
  computeOnTimeProjects,
  computeOperatingMargin,
  computeProjectMargin,
  computeProspectConversion,
  computeRevenueConcentration,
  computeRunway,
  computeStackUsage,
  countNewClients,
  type KpiDeliveredProject,
  type KpiRecurringItem,
} from '../../../../finance/application/kpi-api';
import type { DateRange } from '../../../domain/report-range';
import type { LabelKind } from '../../ports/report-inputs-read.port';
import type { KpiData, KpiWindowData } from './kpi-inputs';
import type { KpiId } from './kpi-catalog';

const ZERO = '0.00';
const TOP_BREAKDOWN = 5;
const byteOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A KPI over one window; the breakdown keys wait for their labels (`labelKind`). */
export interface KpiValue {
  readonly value: MoneyString | null;
  readonly breakdown?: { key: string; value: MoneyString }[];
  readonly labelKind?: Extract<LabelKind, 'CLIENT' | 'PROJECT' | 'TECHNOLOGY'>;
}

const inWindow = (date: DateOnly | null, window: DateRange): date is DateOnly =>
  date !== null && date >= window.from && date <= window.to;

/**
 * The KPI `id` over window `index` of the prefetched data. Every formula is the finance one (C17); this only
 * selects each formula's inputs for the window, the way the mock did (HU-31).
 */
export function kpiValue(id: KpiId, w: KpiWindowData, data: KpiData): KpiValue {
  const { window, close } = w;
  const { billedUsd, collectedUsd, expensesUsd } = w.flows;

  const mrr = (): MoneyString =>
    computeMrr(
      data.charges
        .filter((c) => c.startDate <= close && (c.endDate === null || c.endDate >= close))
        .map<KpiRecurringItem>((c) => ({
          amountUsd: c.monthlyAmountUsd,
          frequency: 'MENSUAL',
          status: c.status,
        })),
    );
  const delivered = (): KpiDeliveredProject[] =>
    data.projects
      .filter((p) => inWindow(p.endDate, window))
      .map((p) => ({
        startDate: p.startDate,
        estimatedEndDate: p.targetEndDate,
        deliveredDate: p.endDate,
      }));

  switch (id) {
    case 'MRR':
      return { value: mrr() };
    case 'ARR':
      return { value: computeArr(mrr()) };
    case 'DSO':
      return {
        value: computeDso({
          receivableUsd: w.receivable.totalUsd,
          billedUsd,
          period: window,
        }),
      };
    case 'COLLECTION_RATE':
      return { value: computeCollectionRate({ collectedUsd, billedUsd }) };
    case 'DELINQUENCY': {
      const receivable = w.receivable;
      return {
        value: computeDelinquency({
          overdueUsd: receivable.overdueUsd,
          receivableUsd: receivable.totalUsd,
        }),
      };
    }
    case 'PROJECT_MARGIN': {
      if (data.clientScoped) return { value: null, breakdown: [], labelKind: 'PROJECT' };
      const collected = w.projectFlows.filter((row) => compareMoney(row.collectedUsd, ZERO) !== 0);
      const breakdown = collected
        .slice()
        .sort(
          (a, b) =>
            compareMoney(b.collectedUsd, a.collectedUsd) || byteOrder(a.projectId, b.projectId),
        )
        .flatMap((row) => {
          const margin = computeProjectMargin({
            collectedUsd: row.collectedUsd,
            allocatedExpensesUsd: row.expensesUsd,
          });
          return margin === null ? [] : [{ key: row.projectId, value: margin }];
        });
      return {
        value: computeProjectMargin({
          collectedUsd: sumMoney(collected.map((row) => row.collectedUsd)),
          allocatedExpensesUsd: sumMoney(collected.map((row) => row.expensesUsd)),
        }),
        breakdown: breakdown.slice(0, TOP_BREAKDOWN),
        labelKind: 'PROJECT',
      };
    }
    case 'OPERATING_MARGIN':
      if (data.clientScoped) return { value: null };
      return { value: computeOperatingMargin({ collectedUsd, expensesUsd }) };
    case 'FIXED_MONTHLY_EXPENSE':
      return {
        value: computeFixedMonthlyExpense(
          data.recurringExpenses.map<KpiRecurringItem>((e) => ({
            amountUsd: e.monthlyAmountUsd,
            frequency: 'MENSUAL',
            status: e.status,
          })),
        ),
      };
    case 'RUNWAY':
      if (data.clientScoped) return { value: null };
      return {
        value: computeRunway({
          accountsBalanceUsd: data.accountsBalanceUsd,
          lastThreeMonthsExpensesUsd: w.lastThreeMonthsExpenses,
        }),
      };
    case 'REVENUE_CONCENTRATION': {
      const shares = computeRevenueConcentration(
        data.collections.filter((row) => row.date <= window.to),
        window.to,
      );
      const breakdown = (['top1', 'top3'] as const).flatMap((key) => {
        const value = shares[key];
        return value === null ? [] : [{ key, value }];
      });
      return { value: shares.top1, breakdown };
    }
    case 'AVG_PROJECT_TICKET':
      return {
        value: computeAvgProjectTicket(
          data.projects.map((p) => ({ startDate: p.startDate, contractedUsd: p.contractedUsd })),
          window,
        ),
      };
    case 'CLIENT_LTV': {
      const ltv = computeClientLtv(data.collections.filter((row) => row.date <= window.to));
      return {
        value: ltv.averageUsd,
        breakdown: ltv.perClient
          .slice(0, TOP_BREAKDOWN)
          .map((row) => ({ key: row.clientId, value: row.ltvUsd })),
        labelKind: 'CLIENT',
      };
    }
    case 'NEW_CLIENTS':
      return { value: String(countNewClients(data.clients, window)) };
    case 'PROSPECT_CONVERSION':
      return { value: computeProspectConversion(data.clients, window) };
    case 'AVG_PROJECT_DURATION':
      return { value: computeAvgProjectDuration(delivered()) };
    case 'ON_TIME_PROJECTS':
      return { value: computeOnTimeProjects(delivered()) };
    case 'STACK_USAGE': {
      const usage = computeStackUsage(
        data.projects
          .filter((p) => p.startDate !== null && p.startDate <= window.to)
          .map((p) => ({ technologies: p.technologyIds })),
      );
      return {
        value: String(usage.length),
        breakdown: usage
          .slice(0, TOP_BREAKDOWN)
          .map((row) => ({ key: row.technology, value: String(row.projects) })),
        labelKind: 'TECHNOLOGY',
      };
    }
    case 'DOCUMENT_COVERAGE':
      return {
        value: computeDocumentCoverage(
          data.projects.map((p) => ({
            status: p.status,
            hasSignedContract: p.hasSignedContract,
            hasCurrentNda: p.ndaExpiries.some((expiry) => expiry === null || expiry >= close),
          })),
        ),
      };
  }
}
