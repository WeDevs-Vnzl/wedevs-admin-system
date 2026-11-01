import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import { compareMoney, type MoneyString } from '../../../../../shared/domain/money';
import type { MonthKey } from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type { OverviewReadPort, PaymentQueues } from '../../ports/overview-read.port';
import { ALL_TIME, lastMonths } from './overview-support';

const MONTHS = 12;

export type BreakdownItem = { key: string; label: string | undefined; value: MoneyString };

export interface PaymentsOverview extends PaymentQueues {
  collectedByMonth: { period: MonthKey; value: MoneyString }[];
  byMethod: BreakdownItem[];
  byAccount: BreakdownItem[];
}

const largestFirst = (a: BreakdownItem, b: BreakdownItem): number =>
  compareMoney(b.value, a.value) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * `GET /payments/overview` (DT-25, PRD §8.6, DT-175). `can(read, payment)` first. "Collected" is the
 * allocated amount of confirmed payments by payment date (DT-98), read from `FinanceFact`; the mock summed
 * the payment amounts. The queues are live counts.
 */
export class GetPaymentsOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly overview: OverviewReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser): Promise<PaymentsOverview> {
    assertCan(this.authorization, actor, 'read', 'payment');
    const today = todayInCaracas(this.clock.now());
    const { range } = lastMonths(today, MONTHS);
    const [series, byMethodRows, byAccountRows, queues] = await Promise.all([
      this.facts.monthlySeries(range, ['COLLECTED']),
      this.facts.sumBy('method', ALL_TIME, ['COLLECTED']),
      this.facts.sumBy('account', ALL_TIME, ['COLLECTED']),
      this.overview.paymentQueues(),
    ]);
    const [methods, accounts] = await Promise.all([
      this.overview.paymentMethodLabels(byMethodRows.map((row) => row.key)),
      this.overview.accountNames(byAccountRows.map((row) => row.key)),
    ]);

    const byMethod = byMethodRows
      .map((row): BreakdownItem => {
        const method = methods.get(row.key);
        return { key: method?.code ?? row.key, label: method?.name, value: row.amounts.COLLECTED };
      })
      .sort(largestFirst);
    const byAccount = byAccountRows
      .map((row): BreakdownItem => ({
        key: row.key,
        label: accounts.get(row.key),
        value: row.amounts.COLLECTED,
      }))
      .sort(largestFirst);

    return {
      collectedByMonth: series.map((point) => ({
        period: point.month,
        value: point.amounts.COLLECTED,
      })),
      byMethod,
      byAccount,
      ...queues,
    };
  }
}
