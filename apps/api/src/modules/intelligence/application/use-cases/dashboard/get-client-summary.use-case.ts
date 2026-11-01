import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { addDays, todayInCaracas } from '../../../../../shared/domain/business-date';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { MoneyString } from '../../../../../shared/domain/money';
import type { DashboardPanelsReadPort } from '../../ports/dashboard-panels-read.port';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';

/** The client's financial summary (`clientFinancialsSchema`), all USD snapshots. */
export interface ClientSummaryOutput {
  readonly clientId: string;
  readonly totalInvoicedUsd: MoneyString;
  readonly totalCollectedUsd: MoneyString;
  readonly receivableUsd: MoneyString;
  readonly overdueUsd: MoneyString;
  /** Confirmed payments not yet allocated ("saldo a favor"). */
  readonly creditBalanceUsd: MoneyString;
  readonly projectCount: number;
  /** The rolling year before today, from `FinanceFact` (Δ6): the mock's `collectedLast12MonthsUsd`. */
  readonly collectedLast12MonthsUsd: MoneyString;
}

/**
 * `GET /clients/{id}/summary` (PRD §8.2, DT-113): the stored `ClientMetrics` plus the rolling twelve months of
 * collections from facts. Without `canSeeFinancials` it is `FORBIDDEN` (the figures are the whole answer).
 * An unknown client is `NOT_FOUND`, and an archived one only for the roles that may restore (C14, C19).
 */
export class GetClientSummary {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly panels: DashboardPanelsReadPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(user: CurrentUser, input: { readonly id: string }): Promise<ClientSummaryOutput> {
    if (!this.authorization.canSeeFinancials(user)) throw new ForbiddenError();
    assertCan(this.authorization, user, 'read', 'client');
    const record = await this.panels.clientMetrics(input.id);
    if (!record || (record.archived && !this.authorization.can(user, 'restore', 'trash'))) {
      throw new NotFoundError();
    }
    const today = todayInCaracas(this.clock.now());
    const rolling = await this.facts.sumByKind(
      { from: addDays(today, -365), to: today },
      { clientId: record.metrics.clientId },
    );
    const m = record.metrics;
    return {
      clientId: m.clientId,
      totalInvoicedUsd: m.invoicedUsd,
      totalCollectedUsd: m.collectedUsd,
      receivableUsd: m.receivableUsd,
      overdueUsd: m.overdueUsd,
      creditBalanceUsd: m.creditUsd,
      projectCount: m.projectCount,
      collectedLast12MonthsUsd: rolling.COLLECTED,
    };
  }
}
