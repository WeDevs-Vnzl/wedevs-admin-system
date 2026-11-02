import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type { ExchangeRatePort } from '../../../src/modules/finance/application/ports/exchange-rate.port';
import type { SelectedRate } from '../../../src/modules/finance/domain/rates';
import { GetClientSummary } from '../../../src/modules/intelligence/application/use-cases/dashboard/get-client-summary.use-case';
import {
  GetDashboard,
  type RecurringSchedulesSource,
} from '../../../src/modules/intelligence/application/use-cases/dashboard/get-dashboard.use-case';
import { GetProjectSummary } from '../../../src/modules/intelligence/application/use-cases/dashboard/get-project-summary.use-case';
import { GetShell } from '../../../src/modules/intelligence/application/use-cases/dashboard/get-shell.use-case';
import { ListAlerts } from '../../../src/modules/intelligence/application/use-cases/alerts/list-alerts.use-case';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { DateOnly } from '../../../src/shared/domain/business-date';
import type { ListQuery } from '../../../src/shared/domain/list-query';
import type { UserRole } from '../../../src/shared/domain/enums';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryEntityMetricsRead } from '../../support/fakes/in-memory-entity-metrics-read';
import { InMemoryFinanceFactsRead } from '../../support/fakes/in-memory-finance-facts-read';
import { InMemoryAlertSources } from '../alerts/fakes/in-memory-alert-sources';
import { InMemoryAlertStateRepository } from '../alerts/fakes/in-memory-alert-state.repository';
import { InMemoryDashboardPanelsRead } from './fakes/in-memory-dashboard-panels-read';

/** Thursday 2026-01-15 in Caracas. */
export const NOW = '2026-01-15T12:00:00.000Z';
export const TODAY: DateOnly = '2026-01-15';

export function userOf(role: UserRole): CurrentUser {
  const id = `usr_${role.toLowerCase()}`;
  return { userId: id, clerkId: `clerk_${id}`, role, email: `${id}@example.test`, name: id };
}

/** Rates by currency; a currency without an entry has none (`null`). `fallbackFrom` marks an earlier date. */
export class FakeRates implements ExchangeRatePort {
  readonly rates = new Map<string, { usdRate: string; fallbackFrom?: DateOnly }>([
    ['VES', { usdRate: '36.5' }],
  ]);
  calls: string[] = [];

  async getRateFor(date: string, currency: string): Promise<SelectedRate | null> {
    this.calls.push(`${date}:${currency}`);
    if (currency === 'USD') {
      return { usdRate: '1', source: null, isFallback: false, effectiveDate: date, options: [] };
    }
    const found = this.rates.get(currency);
    if (!found) return null;
    return {
      usdRate: found.usdRate,
      source: 'BCV',
      isFallback: found.fallbackFrom !== undefined,
      effectiveDate: found.fallbackFrom ?? date,
      options: [],
    };
  }
}

type ScheduleRow = Awaited<ReturnType<RecurringSchedulesSource['execute']>>['items'][number];

/** The owner's `ListRecurringExpenses`, paged over seeded rows. */
class FakeRecurringSchedules implements RecurringSchedulesSource {
  rows: ScheduleRow[] = [];
  queries: ListQuery[] = [];

  async execute(_user: CurrentUser, query: ListQuery) {
    this.queries.push(query);
    const start = (query.page - 1) * query.pageSize;
    return {
      items: this.rows.slice(start, start + query.pageSize),
      total: this.rows.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}

export function buildDashboardWorld() {
  const authorization = new MatrixAuthorization();
  const clock = new FixedClock(NOW);
  const facts = new InMemoryFinanceFactsRead();
  const metrics = new InMemoryEntityMetricsRead();
  const panels = new InMemoryDashboardPanelsRead();
  const rates = new FakeRates();
  const recurring = new FakeRecurringSchedules();
  const sources = new InMemoryAlertSources();
  const states = new InMemoryAlertStateRepository();
  const listAlerts = new ListAlerts(authorization, sources, states, clock);
  return {
    clock,
    facts,
    metrics,
    panels,
    rates,
    recurring,
    sources,
    states,
    dashboard: new GetDashboard(authorization, facts, metrics, panels, rates, clock, recurring),
    shell: new GetShell(listAlerts, rates, clock),
    clientSummary: new GetClientSummary(authorization, panels, facts, clock),
    projectSummary: new GetProjectSummary(authorization, panels),
  };
}
export type DashboardWorld = ReturnType<typeof buildDashboardWorld>;
