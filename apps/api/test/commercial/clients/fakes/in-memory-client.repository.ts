import type {
  ClientListEntry,
  ClientListQuery,
  ClientRepository,
} from '../../../../src/modules/commercial/application/ports/client.repository.port';
import type { ClientRecord } from '../../../../src/modules/commercial/domain/client';
import { taxIdKey } from '../../../../src/modules/commercial/domain/tax-id';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

export interface FakeClientMetrics {
  projectCount: number;
  lastActivityAt: Date | null;
  totalInvoicedUsd: string;
  receivableUsd: string;
}

/**
 * `Client` rows in memory. Writes become visible on commit and vanish on rollback. The list applies only
 * the archived mode and the code order (its filters are proven by the Prisma repository's int test) and
 * records the query it received.
 */
export class InMemoryClientRepository implements ClientRepository, TransactionParticipant {
  private committed = new Map<string, ClientRecord>();
  private pending = new Map<string, ClientRecord>();
  /** Clients with a live project in progress, as the adapter's own query would answer. */
  readonly activeProjects = new Set<string>();
  readonly metrics = new Map<string, FakeClientMetrics>();
  readonly deletedBy = new Map<string, string>();
  readonly listQueries: ClientListQuery[] = [];
  /** Makes the next `restore` fail like a lost race on the unique index. */
  failNextRestoreWith: Error | null = null;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  private get source(): Map<string, ClientRecord> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  seed(record: ClientRecord): ClientRecord {
    this.committed.set(record.id, record);
    return record;
  }

  /** Committed row, for assertions. */
  get(id: string): ClientRecord | undefined {
    return this.committed.get(id);
  }

  get rows(): ClientRecord[] {
    return [...this.committed.values()];
  }

  async findById(id: string): Promise<ClientRecord | null> {
    return this.source.get(id) ?? null;
  }

  async findTaxIdHolder(
    taxId: string,
    country: string,
    exceptId?: string,
  ): Promise<ClientRecord | null> {
    const key = taxIdKey(taxId);
    return (
      [...this.source.values()].find(
        (row) =>
          row.deletedAt === null &&
          row.id !== exceptId &&
          row.country === country &&
          taxIdKey(row.taxId) === key,
      ) ?? null
    );
  }

  async hasActiveProjects(clientId: string): Promise<boolean> {
    return this.activeProjects.has(clientId);
  }

  async insert(record: ClientRecord): Promise<void> {
    this.uow.assertActive('ClientRepository.insert');
    this.pending.set(record.id, record);
  }

  async update(record: ClientRecord): Promise<void> {
    this.uow.assertActive('ClientRepository.update');
    this.pending.set(record.id, record);
  }

  async archive(id: string, at: Date, byUserId: string): Promise<void> {
    this.uow.assertActive('ClientRepository.archive');
    const row = this.pending.get(id);
    if (row) this.pending.set(id, { ...row, deletedAt: at, updatedAt: at });
    this.deletedBy.set(id, byUserId);
  }

  async restore(id: string, at: Date): Promise<void> {
    this.uow.assertActive('ClientRepository.restore');
    if (this.failNextRestoreWith) {
      const error = this.failNextRestoreWith;
      this.failNextRestoreWith = null;
      throw error;
    }
    const row = this.pending.get(id);
    if (row) this.pending.set(id, { ...row, deletedAt: null, updatedAt: at });
    this.deletedBy.delete(id);
  }

  async list(query: ClientListQuery): Promise<Paginated<ClientListEntry>> {
    this.listQueries.push(query);
    const rows = [...this.source.values()]
      .filter((row) =>
        query.archived === 'include'
          ? true
          : query.archived === 'only'
            ? row.deletedAt !== null
            : row.deletedAt === null,
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    const items = rows.map((client) => {
      const metrics = this.metrics.get(client.id);
      return {
        client,
        projectCount: metrics?.projectCount ?? 0,
        lastActivityAt: metrics?.lastActivityAt ?? null,
        totalInvoicedUsd: metrics?.totalInvoicedUsd ?? '0.00',
        receivableUsd: metrics?.receivableUsd ?? '0.00',
      };
    });
    return paginated(items, items.length, query);
  }

  async search(q: string | undefined, limit: number): Promise<ClientRecord[]> {
    const needle = q?.toLowerCase();
    return [...this.source.values()]
      .filter((row) => row.deletedAt === null)
      .filter((row) => !needle || row.tradeName.toLowerCase().includes(needle))
      .sort((a, b) => a.tradeName.localeCompare(b.tradeName))
      .slice(0, limit);
  }

  begin(): void {
    this.pending = new Map(this.committed);
  }
  commit(): void {
    this.committed = this.pending;
  }
  rollback(): void {
    this.pending = new Map(this.committed);
  }
}
