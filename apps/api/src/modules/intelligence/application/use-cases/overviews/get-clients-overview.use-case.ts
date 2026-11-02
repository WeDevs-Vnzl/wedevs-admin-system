import type { ClientListRow } from '../../../../commercial/application/use-cases/client-support';
import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import { todayInCaracas } from '../../../../../shared/domain/business-date';
import type { ClientStatus } from '../../../../../shared/domain/enums';
import { compareMoney, type MoneyString } from '../../../../../shared/domain/money';
import { resolveReportRange } from '../../../domain/report-range';
import type { EntityMetricsReadPort } from '../../ports/entity-metrics-read.port';
import type { FinanceFactsReadPort } from '../../ports/finance-facts-read.port';
import { SHORT_LIST, firstRows, queryOf, rowsByIds, type ListSource } from './overview-support';

const OVERDUE_LIST = 10;

export type ClientRevenueRow = { row: ClientListRow; collectedLast12MonthsUsd: MoneyString };
export type ClientOverdueRow = { row: ClientListRow; overdueUsd: MoneyString };

export interface ClientsOverview {
  countByStatus: Record<ClientStatus, number>;
  topByRevenue: ClientRevenueRow[];
  withOverdueBalance: ClientOverdueRow[];
  recentlyCreated: ClientListRow[];
}

/**
 * `GET /clients/overview` (PRD §8.2, DT-174, DT-175). `can(read, client)` first. Rows are the list rows of
 * `ListClients`, so the chips and the money columns come from their owner. Without `canSeeFinancials` the two
 * lists ranked by money are empty (X15): a client listed there, or its place, would leak what it paid.
 */
export class GetClientsOverview {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly clients: ListSource<ClientListRow>,
    private readonly metrics: EntityMetricsReadPort,
    private readonly facts: FinanceFactsReadPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser): Promise<ClientsOverview> {
    assertCan(this.authorization, actor, 'read', 'client');
    const [countByStatus, recentlyCreated] = await Promise.all([
      this.metrics.clientCountsByStatus(),
      firstRows(
        this.clients,
        actor,
        queryOf({ field: 'createdAt', direction: 'desc' }),
        SHORT_LIST,
      ),
    ]);
    if (!this.authorization.canSeeFinancials(actor)) {
      return { countByStatus, topByRevenue: [], withOverdueBalance: [], recentlyCreated };
    }

    const today = todayInCaracas(this.clock.now());
    const window = resolveReportRange({ preset: 'LAST_12_MONTHS' }, today);
    const [collected, overdue] = await Promise.all([
      this.facts.sumBy('client', window, ['COLLECTED']),
      this.metrics.topClients('overdue', OVERDUE_LIST),
    ]);
    const ranked = collected
      .map((entry) => ({ id: entry.key, amount: entry.amounts.COLLECTED }))
      .filter((entry) => compareMoney(entry.amount, '0') > 0)
      .sort((a, b) => compareMoney(b.amount, a.amount) || (a.id < b.id ? -1 : 1));

    const rows = await rowsByIds(
      this.clients,
      actor,
      { field: 'code', direction: 'asc' },
      new Set([...ranked.map((entry) => entry.id), ...overdue.map((entry) => entry.clientId)]),
      (row) => row.client.id,
    );
    return {
      countByStatus,
      recentlyCreated,
      topByRevenue: ranked
        .flatMap((entry) => {
          const row = rows.get(entry.id);
          return row ? [{ row, collectedLast12MonthsUsd: entry.amount }] : [];
        })
        .slice(0, SHORT_LIST),
      withOverdueBalance: overdue.flatMap((entry) => {
        const row = rows.get(entry.clientId);
        return row ? [{ row, overdueUsd: entry.overdueUsd }] : [];
      }),
    };
  }
}
