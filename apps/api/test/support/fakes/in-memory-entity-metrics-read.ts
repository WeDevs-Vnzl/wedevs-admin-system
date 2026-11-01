import {
  CLIENT_STATUS_VALUES,
  PROJECT_STATUS_VALUES,
  type ClientStatus,
  type ProjectStatus,
} from '../../../src/shared/domain/enums';
import { compareMoney, type MoneyString } from '../../../src/shared/domain/money';
import {
  marginPercentOf,
  type ClientMetricsView,
  type ClientRankMetric,
  type EntityMetricsReadPort,
  type ProjectMetricsView,
  type ProjectRankMetric,
} from '../../../src/modules/intelligence/application/ports/entity-metrics-read.port';

type ClientMoney = Omit<ClientMetricsView, 'clientId' | 'code' | 'tradeName' | 'status'>;
type ProjectMoney = Omit<
  ProjectMetricsView,
  'projectId' | 'code' | 'name' | 'status' | 'marginPercent'
>;

/** What a spec states about a client; the rest is a default (zeros, `ACTIVO`, live). */
export type ClientSeed = {
  id: string;
  tradeName: string;
  status?: ClientStatus;
  archived?: boolean;
  /** Absent: the client has no metrics row yet and reads as zeros. */
  metrics?: Partial<ClientMoney>;
};
export type ProjectSeed = {
  id: string;
  name: string;
  status?: ProjectStatus;
  archived?: boolean;
  metrics?: Partial<ProjectMoney>;
};

export const ZERO_CLIENT_METRICS: ClientMoney = {
  invoicedUsd: '0.00',
  collectedUsd: '0.00',
  receivableUsd: '0.00',
  overdueUsd: '0.00',
  creditUsd: '0.00',
  projectCount: 0,
  lastActivityAt: null,
};
export const ZERO_PROJECT_METRICS: ProjectMoney = {
  contractedUsd: '0.00',
  invoicedUsd: '0.00',
  collectedUsd: '0.00',
  toInvoiceUsd: '0.00',
  receivableUsd: '0.00',
  expensesUsd: '0.00',
  marginUsd: '0.00',
  monthlyRecurringUsd: '0.00',
};

type SeedClient = ClientMetricsView & { archived: boolean };
type SeedProject = Omit<ProjectMetricsView, 'marginPercent'> & { archived: boolean };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Fake `EntityMetricsReadPort`: same ordering, filtering and rounding as the SQL adapter. */
export class InMemoryEntityMetricsRead implements EntityMetricsReadPort {
  private readonly clients: SeedClient[] = [];
  private readonly projects: SeedProject[] = [];

  addClient(seed: ClientSeed): void {
    this.clients.push({
      clientId: seed.id,
      code: `CLI-${seed.id}`,
      tradeName: seed.tradeName,
      status: seed.status ?? 'ACTIVO',
      archived: seed.archived ?? false,
      ...ZERO_CLIENT_METRICS,
      ...seed.metrics,
    });
  }

  addProject(seed: ProjectSeed): void {
    this.projects.push({
      projectId: seed.id,
      code: `PRJ-${seed.id}`,
      name: seed.name,
      status: seed.status ?? 'EN_CURSO',
      archived: seed.archived ?? false,
      ...ZERO_PROJECT_METRICS,
      ...seed.metrics,
    });
  }

  private liveClients(): ClientMetricsView[] {
    return this.clients
      .filter((client) => !client.archived)
      .map(({ archived: _archived, ...rest }) => rest)
      .sort((a, b) => byText(a.tradeName, b.tradeName) || byText(a.clientId, b.clientId));
  }

  private liveProjects(): ProjectMetricsView[] {
    return this.projects
      .filter((project) => !project.archived)
      .map(({ archived: _archived, ...rest }) => ({
        ...rest,
        marginPercent: marginPercentOf(rest.marginUsd, rest.collectedUsd),
      }))
      .sort((a, b) => byText(a.name, b.name) || byText(a.projectId, b.projectId));
  }

  async clientRows(): Promise<ClientMetricsView[]> {
    return this.liveClients();
  }

  async topClients(metric: ClientRankMetric, limit: number): Promise<ClientMetricsView[]> {
    const value = (row: ClientMetricsView): MoneyString =>
      ({
        invoiced: row.invoicedUsd,
        collected: row.collectedUsd,
        receivable: row.receivableUsd,
        overdue: row.overdueUsd,
      })[metric];
    return this.liveClients()
      .filter((row) => compareMoney(value(row), '0') > 0)
      .sort((a, b) => compareMoney(value(b), value(a)))
      .slice(0, limit);
  }

  async clientCountsByStatus(): Promise<Record<ClientStatus, number>> {
    const counts = Object.fromEntries(CLIENT_STATUS_VALUES.map((s) => [s, 0])) as Record<
      ClientStatus,
      number
    >;
    for (const row of this.liveClients()) counts[row.status] += 1;
    return counts;
  }

  async projectRows(): Promise<ProjectMetricsView[]> {
    return this.liveProjects();
  }

  async topProjects(metric: ProjectRankMetric, limit: number): Promise<ProjectMetricsView[]> {
    const value = (row: ProjectMetricsView): MoneyString =>
      ({
        invoiced: row.invoicedUsd,
        collected: row.collectedUsd,
        toInvoice: row.toInvoiceUsd,
        receivable: row.receivableUsd,
        margin: row.marginUsd,
      })[metric];
    return this.liveProjects()
      .filter((row) => compareMoney(value(row), '0') > 0)
      .sort((a, b) => compareMoney(value(b), value(a)))
      .slice(0, limit);
  }

  async projectCountsByStatus(): Promise<Record<ProjectStatus, number>> {
    const counts = Object.fromEntries(PROJECT_STATUS_VALUES.map((s) => [s, 0])) as Record<
      ProjectStatus,
      number
    >;
    for (const row of this.liveProjects()) counts[row.status] += 1;
    return counts;
  }
}
