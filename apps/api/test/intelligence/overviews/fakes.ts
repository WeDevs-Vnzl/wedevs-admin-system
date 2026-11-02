import type { CurrentUser } from '../../../src/shared/application/current-user';
import { todayInCaracas, type DateOnly } from '../../../src/shared/domain/business-date';
import type { ListQuery } from '../../../src/shared/domain/list-query';
import { paginated, type Paginated } from '../../../src/shared/domain/pagination';
import { sumMoney, type MoneyString } from '../../../src/shared/domain/money';
import type {
  ActivityCounts,
  DocumentCategoryCounts,
  ExpiringCounts,
  InvoiceCurrencyTotal,
  OverviewReadPort,
  PaymentQueues,
  TechnologyUsageRow,
} from '../../../src/modules/intelligence/application/ports/overview-read.port';
import type { ListSource } from '../../../src/modules/intelligence/application/use-cases/overviews/overview-support';
import type { ActivityListCriteria } from '../../../src/modules/platform/application/ports/activity-read.port';

/** A list use case of another context: serves the seeded items page by page and records every query. */
export class FakeListSource<T> implements ListSource<T> {
  readonly queries: { actor: CurrentUser; query: ListQuery }[] = [];

  constructor(public items: T[] = []) {}

  async execute(actor: CurrentUser, query: ListQuery): Promise<Paginated<T>> {
    this.queries.push({ actor, query });
    const start = (query.page - 1) * query.pageSize;
    return paginated(this.items.slice(start, start + query.pageSize), this.items.length, query);
  }
}

const ZERO = '0.00';

/** In-memory `OverviewReadPort`: each aggregate is a field a spec sets; the labels are maps. */
export class InMemoryOverviewRead implements OverviewReadPort {
  technologies: TechnologyUsageRow[] = [];
  invoiceTotals: InvoiceCurrencyTotal[] = [];
  methods = new Map<string, { code: string; name: string }>();
  accounts = new Map<string, string>();
  categories = new Map<string, string>();
  queues: PaymentQueues = {
    pendingVerificationCount: 0,
    unallocatedCount: 0,
    unallocatedTotalUsd: ZERO,
  };
  committed: MoneyString = ZERO;
  documentCategories: DocumentCategoryCounts[] = [];
  expiring: ExpiringCounts = { days30: 0, days60: 0, days90: 0 };
  activity: ActivityCounts = { total: 0, today: 0, users: 0 };
  readonly activityRequests: {
    filter: ActivityListCriteria;
    todayStart: Date;
    tomorrowStart: Date;
  }[] = [];
  expiringAsked: DateOnly[] = [];

  async topTechnologies(limit: number): Promise<TechnologyUsageRow[]> {
    return this.technologies.slice(0, limit);
  }
  async invoiceCurrencyTotals(): Promise<InvoiceCurrencyTotal[]> {
    return this.invoiceTotals;
  }
  async paymentMethodLabels(ids: readonly string[]) {
    return new Map([...this.methods].filter(([id]) => ids.includes(id)));
  }
  async accountNames(ids: readonly string[]) {
    return new Map([...this.accounts].filter(([id]) => ids.includes(id)));
  }
  async expenseCategoryNames(ids: readonly string[]) {
    return new Map([...this.categories].filter(([id]) => ids.includes(id)));
  }
  async paymentQueues(): Promise<PaymentQueues> {
    return this.queues;
  }
  async committedMonthlyUsd(): Promise<MoneyString> {
    return sumMoney([this.committed]);
  }
  async documentCategoryCounts(): Promise<DocumentCategoryCounts[]> {
    return this.documentCategories;
  }
  async documentExpiringCounts(today: DateOnly): Promise<ExpiringCounts> {
    this.expiringAsked.push(today);
    return this.expiring;
  }
  async activityCounts(request: {
    filter: ActivityListCriteria;
    todayStart: Date;
    tomorrowStart: Date;
  }): Promise<ActivityCounts> {
    this.activityRequests.push(request);
    return this.activity;
  }
}

export const caracasToday = (instant: Date): DateOnly => todayInCaracas(instant);
