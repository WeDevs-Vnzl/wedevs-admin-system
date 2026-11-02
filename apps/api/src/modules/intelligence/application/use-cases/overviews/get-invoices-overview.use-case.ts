import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import type { MoneyString } from '../../../../../shared/domain/money';
import type { MonthKey } from '../../../domain/report-range';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import type { OverviewReadPort } from '../../ports/overview-read.port';
import { lastMonths } from './overview-support';

const MONTHS = 6;

export interface InvoicesOverview {
  periods: MonthKey[];
  billed: MoneyString[];
  collected: MoneyString[];
  /** Open receivable in USD by days past due at today. */
  aging: { d0_30: MoneyString; d31_60: MoneyString; d61_90: MoneyString; d90plus: MoneyString };
  overdueCount: number;
  totalsByCurrency: {
    currency: string;
    total: MoneyString;
    balance: MoneyString;
    overdue: MoneyString;
  }[];
}

/**
 * `GET /invoices/overview` (DT-25, PRD §8.5, DT-175). `can(read, invoice)` first: Member and Viewer get
 * `FORBIDDEN`. Billed and collected come from `FinanceFact` (collected is the allocation, DT-98), the aging
 * is the receivable of DT-125 at today, and the per-currency totals are live counts of the invoices.
 */
export class GetInvoicesOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly overview: OverviewReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser): Promise<InvoicesOverview> {
    assertCan(this.authorization, actor, 'read', 'invoice');
    const today = todayInCaracas(this.clock.now());
    const { months, range } = lastMonths(today, MONTHS);
    const [series, aging, totals] = await Promise.all([
      this.facts.monthlySeries(range, ['BILLED', 'COLLECTED'], undefined),
      this.facts.agingAt(today),
      this.overview.invoiceCurrencyTotals(),
    ]);
    return {
      periods: months,
      billed: series.map((point) => point.amounts.BILLED),
      collected: series.map((point) => point.amounts.COLLECTED),
      aging: aging.totals,
      overdueCount: totals.reduce((sum, row) => sum + row.overdueCount, 0),
      totalsByCurrency: totals.map(({ overdueCount: _count, ...row }) => row),
    };
  }
}
