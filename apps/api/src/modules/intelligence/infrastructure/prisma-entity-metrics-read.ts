import { Injectable } from '@nestjs/common';
import {
  CLIENT_STATUS_VALUES,
  PROJECT_STATUS_VALUES,
  type ClientStatus,
  type ProjectStatus,
} from '../../../shared/domain/enums';
import type { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { computeProjectMargin } from '../../finance/application/kpi-api';
import { subMoney } from '../../../shared/domain/money';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import {
  type ClientMetricsView,
  type ClientRankMetric,
  type EntityMetricsReadPort,
  type ProjectMetricsView,
  type ProjectRankMetric,
} from '../application/ports/entity-metrics-read.port';

const ZERO = '0.00';
/** Columns are `Decimal(18,2)`: two decimals, as the string contract of the port says. */
const money = (value: Prisma.Decimal | undefined): string => (value ? value.toFixed(2) : ZERO);

const CLIENT_COLUMN = {
  invoiced: 'invoicedUsd',
  collected: 'collectedUsd',
  receivable: 'receivableUsd',
  overdue: 'overdueUsd',
} as const satisfies Record<ClientRankMetric, string>;

const PROJECT_COLUMN = {
  invoiced: 'invoicedUsd',
  collected: 'collectedUsd',
  toInvoice: 'toInvoiceUsd',
  receivable: 'receivableUsd',
  margin: 'marginUsd',
} as const satisfies Record<ProjectRankMetric, string>;

type ClientRow = Prisma.ClientGetPayload<{ include: { metrics: true } }>;
type ProjectRow = Prisma.ProjectGetPayload<{ include: { metrics: true } }>;

function clientView(row: ClientRow): ClientMetricsView {
  const m = row.metrics;
  return {
    clientId: row.id,
    code: row.code,
    tradeName: row.tradeName,
    status: row.status,
    invoicedUsd: money(m?.invoicedUsd),
    collectedUsd: money(m?.collectedUsd),
    receivableUsd: money(m?.receivableUsd),
    overdueUsd: money(m?.overdueUsd),
    creditUsd: money(m?.creditUsd),
    projectCount: m?.projectCount ?? 0,
    lastActivityAt: m?.lastActivityAt ?? null,
  };
}

function projectView(row: ProjectRow): ProjectMetricsView {
  const m = row.metrics;
  const marginUsd = money(m?.marginUsd);
  const collectedUsd = money(m?.collectedUsd);
  return {
    projectId: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    contractedUsd: money(m?.contractedUsd),
    invoicedUsd: money(m?.invoicedUsd),
    collectedUsd,
    toInvoiceUsd: money(m?.toInvoiceUsd),
    receivableUsd: money(m?.receivableUsd),
    expensesUsd: subMoney(collectedUsd, marginUsd),
    marginUsd,
    monthlyRecurringUsd: money(m?.monthlyRecurringUsd),
    marginPercent: computeProjectMargin({
      collectedUsd,
      allocatedExpensesUsd: subMoney(collectedUsd, marginUsd),
    }),
  };
}

/**
 * Reads `ClientMetrics` and `ProjectMetrics` with their owners (DT-111, DT-170). Archived owners are
 * excluded explicitly (`deletedAt: null`), on top of the soft-delete extension. Reads only.
 */
@Injectable()
export class PrismaEntityMetricsRead implements EntityMetricsReadPort {
  constructor(private readonly host: TransactionHost) {}

  async clientRows(): Promise<ClientMetricsView[]> {
    const rows = await this.host.db.client.findMany({
      where: { deletedAt: null },
      include: { metrics: true },
      orderBy: [{ tradeName: 'asc' }, { id: 'asc' }],
    });
    return rows.map(clientView);
  }

  async topClients(metric: ClientRankMetric, limit: number): Promise<ClientMetricsView[]> {
    if (limit <= 0) return [];
    const column = CLIENT_COLUMN[metric];
    const rows = await this.host.db.client.findMany({
      where: { deletedAt: null, metrics: { is: { [column]: { gt: 0 } } } },
      include: { metrics: true },
      orderBy: [{ metrics: { [column]: 'desc' } }, { tradeName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(clientView);
  }

  async clientCountsByStatus(): Promise<Record<ClientStatus, number>> {
    const groups = await this.host.db.client.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(CLIENT_STATUS_VALUES.map((s) => [s, 0])) as Record<
      ClientStatus,
      number
    >;
    for (const group of groups) counts[group.status] = group._count._all;
    return counts;
  }

  async projectRows(): Promise<ProjectMetricsView[]> {
    const rows = await this.host.db.project.findMany({
      where: { deletedAt: null },
      include: { metrics: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(projectView);
  }

  async topProjects(metric: ProjectRankMetric, limit: number): Promise<ProjectMetricsView[]> {
    if (limit <= 0) return [];
    const column = PROJECT_COLUMN[metric];
    const rows = await this.host.db.project.findMany({
      where: { deletedAt: null, metrics: { is: { [column]: { gt: 0 } } } },
      include: { metrics: true },
      orderBy: [{ metrics: { [column]: 'desc' } }, { name: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(projectView);
  }

  async projectCountsByStatus(): Promise<Record<ProjectStatus, number>> {
    const groups = await this.host.db.project.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(PROJECT_STATUS_VALUES.map((s) => [s, 0])) as Record<
      ProjectStatus,
      number
    >;
    for (const group of groups) counts[group.status] = group._count._all;
    return counts;
  }
}
