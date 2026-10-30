import type {
  ProjectListRequest,
  ProjectMetricsRow,
  ProjectRepository,
} from '../../../../src/modules/commercial/application/ports/project.repository.port';
import type {
  ProjectClientLink,
  ProjectRecord,
} from '../../../../src/modules/commercial/domain/project';
import type { ProjectLinkRecord } from '../../../../src/modules/commercial/domain/project-link';
import type { EntityRef } from '../../../../src/shared/domain/entity-ref';
import { foldText } from '../../../../src/shared/domain/list-query';
import { PROJECT_STATUS_VALUES } from '../../../../src/shared/domain/enums';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Fake `ProjectRepository`. Writes made inside a unit of work become visible on commit and are discarded
 * on rollback, like the adapter. `writeCount` counts every write so tests can assert that a rejected
 * command wrote nothing. Clients are a small registry (`addClient`) standing in for the `Client` table.
 */
export class InMemoryProjectRepository implements ProjectRepository, TransactionParticipant {
  private committed = new Map<string, ProjectRecord>();
  private pending = new Map<string, ProjectRecord>();
  private readonly clients = new Map<string, EntityRef & { archived: boolean }>();
  private readonly metrics = new Map<string, ProjectMetricsRow>();
  writeCount = 0;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  // ── test helpers ──
  addClient(id: string, label: string, options: { archived?: boolean } = {}): void {
    this.clients.set(id, {
      type: 'CLIENT',
      id,
      code: `CLI-${id}`,
      label,
      archived: options.archived ?? false,
    });
  }

  archiveClient(id: string): void {
    const client = this.clients.get(id);
    if (client) client.archived = true;
  }

  setMetrics(projectId: string, row: ProjectMetricsRow): void {
    this.metrics.set(projectId, row);
  }

  seed(...records: ProjectRecord[]): void {
    for (const record of records) this.committed.set(record.id, clone(record));
  }

  /** Committed row, for assertions after the call returned or threw. */
  get(id: string): ProjectRecord | undefined {
    return this.committed.get(id);
  }

  get rows(): readonly ProjectRecord[] {
    return [...this.committed.values()];
  }

  private view(): Map<string, ProjectRecord> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  private require(id: string): ProjectRecord {
    const row = this.view().get(id);
    if (!row) throw new Error(`InMemoryProjectRepository: unknown project ${id}`);
    return row;
  }

  private write(id: string, change: (row: ProjectRecord) => ProjectRecord): void {
    this.uow.assertActive('ProjectRepository write');
    this.writeCount += 1;
    this.pending.set(id, change(this.require(id)));
  }

  // ── ProjectRepository ──
  async findById(id: string): Promise<ProjectRecord | null> {
    const row = this.view().get(id);
    return row ? clone(row) : null;
  }

  async insert(record: ProjectRecord): Promise<void> {
    this.uow.assertActive('ProjectRepository.insert');
    this.writeCount += 1;
    this.pending.set(record.id, clone(record));
  }

  async updateFields(record: ProjectRecord): Promise<void> {
    this.write(record.id, (row) => ({
      ...row,
      name: record.name,
      summary: record.summary,
      description: record.description,
      descriptionText: record.descriptionText,
      status: record.status,
      startDate: record.startDate,
      targetEndDate: record.targetEndDate,
      endDate: record.endDate,
    }));
  }

  async touch(id: string): Promise<void> {
    this.write(id, (row) => ({ ...row }));
  }

  async replaceClients(projectId: string, clients: readonly ProjectClientLink[]): Promise<void> {
    this.write(projectId, (row) => ({ ...row, clients: clone([...clients]) }));
  }

  async replaceTechnologies(projectId: string, technologyIds: readonly string[]): Promise<void> {
    this.write(projectId, (row) => ({ ...row, technologyIds: [...new Set(technologyIds)] }));
  }

  async replaceLinks(projectId: string, links: readonly ProjectLinkRecord[]): Promise<void> {
    this.write(projectId, (row) => ({ ...row, links: clone([...links]) }));
  }

  async setArchived(ids: readonly string[], at: Date | null): Promise<void> {
    for (const id of ids) this.write(id, (row) => ({ ...row, archivedAt: at }));
  }

  async list(request: ProjectListRequest): Promise<{ records: ProjectRecord[]; total: number }> {
    const { filters, archived, sort } = request;
    const match = (record: ProjectRecord): boolean => {
      if (archived === 'exclude' && record.archivedAt !== null) return false;
      if (archived === 'only' && record.archivedAt === null) return false;
      if (filters.status?.length && !filters.status.includes(record.status)) return false;
      if (
        filters.clientIds?.length &&
        !record.clients.some((link) => filters.clientIds?.includes(link.clientId))
      ) {
        return false;
      }
      if (
        filters.technologyIds?.length &&
        !record.technologyIds.some((id) => filters.technologyIds?.includes(id))
      ) {
        return false;
      }
      if (
        filters.deliveryFrom &&
        !(record.targetEndDate && record.targetEndDate >= filters.deliveryFrom)
      ) {
        return false;
      }
      if (
        filters.deliveryTo &&
        !(record.targetEndDate && record.targetEndDate <= filters.deliveryTo)
      ) {
        return false;
      }
      if (filters.q) {
        const needle = foldText(filters.q);
        const haystack = [
          record.code,
          record.name,
          ...record.clients.map((link) => this.clients.get(link.clientId)?.label ?? ''),
        ].map(foldText);
        if (!haystack.some((text) => text.includes(needle))) return false;
      }
      return true;
    };

    const key = (record: ProjectRecord): string | number => {
      const money = this.metrics.get(record.id);
      switch (sort.field) {
        case 'status':
          return PROJECT_STATUS_VALUES.indexOf(record.status);
        case 'contractedValueUsd':
        case 'invoicedUsd':
        case 'collectedUsd':
        case 'toInvoiceUsd':
          return Number(money?.[sort.field] ?? '0');
        case 'createdAt':
          return record.createdAt.getTime();
        default:
          return String((record as unknown as Record<string, unknown>)[sort.field] ?? '');
      }
    };
    const direction = sort.direction === 'asc' ? 1 : -1;
    const rows = [...this.view().values()].filter(match).sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1) * direction;
    });
    const start = (request.page - 1) * request.pageSize;
    return { records: clone(rows.slice(start, start + request.pageSize)), total: rows.length };
  }

  async metricsFor(ids: readonly string[]): Promise<Map<string, ProjectMetricsRow>> {
    const found = new Map<string, ProjectMetricsRow>();
    for (const id of ids) {
      const row = this.metrics.get(id);
      if (row) found.set(id, row);
    }
    return found;
  }

  async liveClientIds(ids: readonly string[]): Promise<string[]> {
    return ids.filter((id) => {
      const client = this.clients.get(id);
      return client !== undefined && !client.archived;
    });
  }

  async clientRefs(ids: readonly string[]): Promise<EntityRef[]> {
    return [...new Set(ids)].flatMap((id) => {
      const client = this.clients.get(id);
      return client
        ? [{ type: client.type, id: client.id, code: client.code, label: client.label }]
        : [];
    });
  }

  async countLiveProjectsOfClient(clientId: string): Promise<number> {
    return [...this.view().values()].filter(
      (record) =>
        record.archivedAt === null && record.clients.some((link) => link.clientId === clientId),
    ).length;
  }

  async countLiveByTechnology(technologyId: string): Promise<number> {
    return [...this.view().values()].filter(
      (record) => record.archivedAt === null && record.technologyIds.includes(technologyId),
    ).length;
  }

  async detachTechnologyFromArchived(technologyId: string): Promise<void> {
    this.uow.assertActive('ProjectRepository.detachTechnologyFromArchived');
    for (const [id, record] of this.pending) {
      if (record.archivedAt !== null && record.technologyIds.includes(technologyId)) {
        this.writeCount += 1;
        this.pending.set(id, {
          ...record,
          technologyIds: record.technologyIds.filter((tech) => tech !== technologyId),
        });
      }
    }
  }

  begin(): void {
    this.pending = clone(this.committed);
  }

  commit(): void {
    this.committed = this.pending;
  }

  rollback(): void {
    this.pending = clone(this.committed);
  }
}
