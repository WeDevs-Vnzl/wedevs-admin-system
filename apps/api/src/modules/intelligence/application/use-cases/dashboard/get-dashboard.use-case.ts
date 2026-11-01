import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import {
  addDays,
  daysBetween,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { EntityRef } from '../../../../../shared/domain/entity-ref';
import {
  roundMoney,
  subMoney,
  sumMoney,
  toUsd,
  type MoneyString,
} from '../../../../../shared/domain/money';
import type { ExchangeRatePort } from '../../../../finance/application/ports/exchange-rate.port';
import { computeMrr } from '../../../../finance/application/kpi-api';
import {
  businessMonthOf,
  dashboardPeriodRange,
  trailingMonths,
  type DashboardPeriod,
  type DashboardPeriodRange,
} from '../../../domain/dashboard-period';
import { changePercent, monthEnd, monthOf, monthStart } from '../../../domain/report-range';
import type { DashboardPanelsReadPort } from '../../ports/dashboard-panels-read.port';
import type { EntityMetricsReadPort } from '../../ports/entity-metrics-read.port';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import {
  DASHBOARD_KPI_IDS,
  DASHBOARD_KPI_UNITS,
  ZERO,
  type DashboardKpiId,
  type KpiCardOutput,
} from './dashboard-support';

const WINDOW_DAYS = 30;
const CHART_MONTHS = 12;
const TOP_INVOICES = 5;
const RECENT_EVENTS = 15;
const ACTIVE_PROJECT_STATUSES = ['EN_CURSO', 'MANTENIMIENTO'] as const;

export interface GetDashboardInput {
  /** `month` (default), `quarter` or `year`; checked here, not only in the DTO. */
  readonly period?: string | undefined;
  /** `YYYY-MM` anchor of the period; defaults to the current business month. */
  readonly month?: string | undefined;
}

export interface DashboardOutput {
  readonly month: string;
  readonly period: DashboardPeriod;
  readonly periodStart: DateOnly;
  readonly periodEnd: DateOnly;
  readonly currency: 'USD';
  readonly kpis: KpiCardOutput[];
  readonly incomeVsExpenses: {
    readonly periods: string[];
    readonly series: { readonly id: 'income' | 'expenses'; readonly values: MoneyString[] }[];
  };
  readonly invoicesDue: {
    readonly invoice: EntityRef;
    readonly client: EntityRef;
    readonly dueDate: DateOnly;
    readonly currency: string;
    readonly balance: MoneyString;
    readonly balanceUsd: MoneyString;
    /** Negative when overdue. */
    readonly daysUntilDue: number;
  }[];
  readonly installmentsToInvoice: {
    readonly installment: EntityRef;
    readonly project: EntityRef;
    readonly amount: MoneyString;
    readonly currency: string;
    readonly dueDate: DateOnly | null;
  }[];
  readonly documentsExpiring: {
    readonly document: EntityRef;
    readonly expiresAt: DateOnly;
    readonly daysLeft: number;
  }[];
  readonly upcomingRecurringExpenses: {
    readonly expense: EntityRef;
    readonly dueDate: DateOnly;
    readonly amount: MoneyString;
    readonly currency: string;
    readonly amountUsd: MoneyString;
  }[];
  readonly recentActivity: {
    readonly id: string;
    readonly action: string;
    readonly entity: EntityRef | null;
    readonly actorName: string | null;
    readonly createdAt: Date;
  }[];
}

function card(
  id: DashboardKpiId,
  value: MoneyString,
  previousValue: MoneyString | null,
  secondaryValue: MoneyString | null = null,
): KpiCardOutput {
  return {
    id,
    unit: DASHBOARD_KPI_UNITS[id],
    value,
    previousValue,
    changePercent: changePercent(value, previousValue),
    secondaryValue,
  };
}

/**
 * `GET /dashboard` (PRD §8.1, DT-172–DT-175): the eight cards, the twelve-month chart and the five panels.
 * The route is `@Authenticated()`; what a role sees is decided by data here. Every figure is a USD snapshot
 * summed from `FinanceFact` (C16), a decimal string (C15). Without `canSeeFinancials` the financial cards are
 * zero with no comparison and the financial panels are empty; documents follow `read document` and the
 * activity log `read activity`. A period that starts after today answers `VALIDATION` before any read.
 */
export class GetDashboard {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly metrics: EntityMetricsReadPort,
    private readonly panels: DashboardPanelsReadPort,
    private readonly rates: ExchangeRatePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: GetDashboardInput): Promise<DashboardOutput> {
    const today = todayInCaracas(this.clock.now());
    const period = (input.period ?? 'month') as DashboardPeriod;
    const month = input.month ?? businessMonthOf(today);
    const range = dashboardPeriodRange(period, month, today);
    if (range.start > today) {
      throw new ValidationFailedError({
        message: 'dashboard.validation.futurePeriod',
        fieldErrors: { month: ['dashboard.validation.futurePeriod'] },
      });
    }

    const financial = this.authorization.canSeeFinancials(user);
    const [kpis, incomeVsExpenses, panels] = await Promise.all([
      this.cards(range, today, financial),
      this.chart(range, financial),
      this.panelsOf(user, today, financial),
    ]);
    return {
      month,
      period: range.period,
      periodStart: range.start,
      periodEnd: range.end,
      currency: 'USD',
      kpis,
      incomeVsExpenses,
      ...panels,
    };
  }

  private async activeProjects(): Promise<string> {
    const counts = await this.metrics.projectCountsByStatus();
    return String(ACTIVE_PROJECT_STATUSES.reduce((sum, status) => sum + counts[status], 0));
  }

  private async cards(
    range: DashboardPeriodRange,
    today: DateOnly,
    financial: boolean,
  ): Promise<KpiCardOutput[]> {
    const active = await this.activeProjects();
    if (!financial) {
      return DASHBOARD_KPI_IDS.map((id) =>
        id === 'ACTIVE_PROJECTS' ? card(id, active, null) : card(id, ZERO, null),
      );
    }
    const { previous } = range;
    const [now, before, receivable, receivableBefore, mrr, mrrBefore, balance] = await Promise.all([
      this.facts.sumByKind({ from: range.start, to: range.end }),
      this.facts.sumByKind({ from: previous.start, to: previous.end }),
      this.facts.receivableAt(range.close),
      this.facts.receivableAt(previous.close),
      this.mrrAt(range.close),
      this.mrrAt(previous.close),
      this.accountsBalance(today),
    ]);
    const result = subMoney(now.COLLECTED, now.EXPENSE_PAID);
    const resultBefore = subMoney(before.COLLECTED, before.EXPENSE_PAID);
    const cards: Record<DashboardKpiId, KpiCardOutput> = {
      COLLECTED_MONTH: card('COLLECTED_MONTH', now.COLLECTED, before.COLLECTED),
      BILLED_MONTH: card('BILLED_MONTH', now.BILLED, before.BILLED),
      RECEIVABLE: card(
        'RECEIVABLE',
        receivable.totalUsd,
        receivableBefore.totalUsd,
        receivable.overdueUsd,
      ),
      EXPENSES_MONTH: card('EXPENSES_MONTH', now.EXPENSE_PAID, before.EXPENSE_PAID),
      RESULT_MONTH: card('RESULT_MONTH', result, resultBefore),
      ACCOUNTS_BALANCE: card('ACCOUNTS_BALANCE', balance, null),
      MRR: card('MRR', mrr, mrrBefore),
      ACTIVE_PROJECTS: card('ACTIVE_PROJECTS', active, null),
    };
    return DASHBOARD_KPI_IDS.map((id) => cards[id]);
  }

  /** MRR from the stored monthly USD amounts (DT-100) of the charges whose dates cover `date` (A13). */
  private async mrrAt(date: DateOnly): Promise<MoneyString> {
    const charges = await this.panels.recurringChargesAt(date);
    return computeMrr(
      charges.map((charge) => ({
        amountUsd: charge.monthlyAmountUsd,
        frequency: 'MENSUAL' as const,
        status: charge.status,
      })),
    );
  }

  /** Active accounts at today's rate (§8.1); an account whose currency has no rate adds nothing. */
  private async accountsBalance(today: DateOnly): Promise<MoneyString> {
    const accounts = await this.panels.activeAccountBalances();
    const currencies = [...new Set(accounts.map((account) => account.currency))];
    const rates = new Map(
      await Promise.all(
        currencies.map(
          async (currency) =>
            [currency, (await this.rates.getRateFor(today, currency))?.usdRate ?? null] as const,
        ),
      ),
    );
    return sumMoney(
      accounts.flatMap((account) => {
        const rate = rates.get(account.currency);
        return rate ? [toUsd(roundMoney(account.balance), rate)] : [];
      }),
    );
  }

  private async chart(
    range: DashboardPeriodRange,
    financial: boolean,
  ): Promise<DashboardOutput['incomeVsExpenses']> {
    const months = trailingMonths(monthOf(range.close), CHART_MONTHS);
    const first = months[0] as string;
    const last = months[CHART_MONTHS - 1] as string;
    const series = financial
      ? await this.facts.monthlySeries({ from: monthStart(first), to: monthEnd(last) }, [
          'COLLECTED',
          'EXPENSE_PAID',
        ])
      : [];
    const byMonth = new Map(series.map((row) => [row.month, row.amounts]));
    const values = (kind: 'COLLECTED' | 'EXPENSE_PAID') =>
      months.map((month) => byMonth.get(month)?.[kind] ?? ZERO);
    return {
      periods: months,
      series: [
        { id: 'income', values: values('COLLECTED') },
        { id: 'expenses', values: values('EXPENSE_PAID') },
      ],
    };
  }

  private async panelsOf(
    user: CurrentUser,
    today: DateOnly,
    financial: boolean,
  ): Promise<
    Pick<
      DashboardOutput,
      | 'invoicesDue'
      | 'installmentsToInvoice'
      | 'documentsExpiring'
      | 'upcomingRecurringExpenses'
      | 'recentActivity'
    >
  > {
    const until = addDays(today, WINDOW_DAYS);
    const [invoices, installments, documents, recurring, activity] = await Promise.all([
      financial ? this.panels.invoicesDue(TOP_INVOICES) : [],
      financial ? this.panels.installmentsToInvoice(until) : [],
      this.authorization.can(user, 'read', 'document')
        ? this.panels.documentsExpiring(today, until)
        : [],
      financial ? this.panels.upcomingRecurringExpenses(until) : [],
      this.authorization.can(user, 'read', 'activity')
        ? this.panels.recentActivity(RECENT_EVENTS)
        : [],
    ]);
    return {
      invoicesDue: invoices.map((row) => ({
        ...row,
        daysUntilDue: daysBetween(today, row.dueDate),
      })),
      installmentsToInvoice: installments,
      documentsExpiring: documents.map((row) => ({
        ...row,
        daysLeft: daysBetween(today, row.expiresAt),
      })),
      upcomingRecurringExpenses: recurring,
      recentActivity: activity,
    };
  }
}
