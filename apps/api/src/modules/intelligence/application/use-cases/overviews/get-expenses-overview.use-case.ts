import type { ExpenseOutput } from '../../../../finance/application/use-cases/expenses/expense-support';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { sumMoney, type MoneyString } from '../../../../../shared/domain/money';
import { monthEnd, monthStart, type MonthKey } from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type { OverviewReadPort } from '../../ports/overview-read.port';
import { SHORT_LIST, firstRows, lastMonths, queryOf, type ListSource } from './overview-support';

const MONTHS = 6;

export interface ExpensesOverview {
  byMonthAndCategory: {
    periods: MonthKey[];
    series: { id: string; label: string | undefined; values: MoneyString[] }[];
  };
  byCategory: { key: string; label: string | undefined; value: MoneyString }[];
  /** Active recurring expenses, normalised to a month, in USD. */
  committedMonthly: MoneyString;
  upcoming: ExpenseOutput[];
}

/**
 * `GET /expenses/overview` (DT-25, PRD §8.8, DT-175). `can(read, expense)` first. Paid spend per month and
 * root category comes from `EXPENSE_PAID` facts; the committed monthly spend sums the USD snapshots of the
 * active schedules (DT-100); the upcoming rows are the owner's, pending ones by due date.
 */
export class GetExpensesOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly overview: OverviewReadPort,
    private readonly expenses: ListSource<ExpenseOutput>,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser): Promise<ExpensesOverview> {
    assertCan(this.authorization, actor, 'read', 'expense');
    const today = todayInCaracas(this.clock.now());
    const { months } = lastMonths(today, MONTHS);

    const [perMonth, committedMonthly, upcoming] = await Promise.all([
      Promise.all(
        months.map((month) =>
          this.facts.sumBy('category', { from: monthStart(month), to: monthEnd(month) }, [
            'EXPENSE_PAID',
          ]),
        ),
      ),
      this.overview.committedMonthlyUsd(),
      firstRows(
        this.expenses,
        actor,
        queryOf({ field: 'dueDate', direction: 'asc' }, { status: ['PENDIENTE'] }),
        SHORT_LIST,
      ),
    ]);

    const rootIds = [...new Set(perMonth.flatMap((rows) => rows.map((row) => row.key)))];
    const names = await this.overview.expenseCategoryNames(rootIds);
    const series = rootIds
      .map((id) => ({
        id,
        label: names.get(id),
        values: perMonth.map(
          (rows) => rows.find((row) => row.key === id)?.amounts.EXPENSE_PAID ?? '0.00',
        ),
      }))
      .sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id, 'es'));

    return {
      byMonthAndCategory: { periods: months, series },
      byCategory: series.map((item) => ({
        key: item.id,
        label: item.label,
        value: sumMoney(item.values),
      })),
      committedMonthly,
      upcoming,
    };
  }
}
