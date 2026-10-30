import type { ContactRepository } from '../../../../src/modules/commercial/application/ports/contact.repository.port';
import {
  sortContacts,
  type ContactRecord,
} from '../../../../src/modules/commercial/domain/contact';
import type { ListQuery } from '../../../../src/shared/domain/list-query';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type { InMemoryClientRepository } from './in-memory-client.repository';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/** `Contact` rows in memory. Writes become visible on commit and vanish on rollback. */
export class InMemoryContactRepository implements ContactRepository, TransactionParticipant {
  private committed = new Map<string, ContactRecord>();
  private pending = new Map<string, ContactRecord>();
  readonly listQueries: { clientId: string; query: ListQuery }[] = [];

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    private readonly clients: InMemoryClientRepository,
  ) {
    uow.enlist(this);
  }

  private get source(): Map<string, ContactRecord> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  seed(record: ContactRecord): ContactRecord {
    this.committed.set(record.id, record);
    return record;
  }

  get(id: string): ContactRecord | undefined {
    return this.committed.get(id);
  }

  get rows(): ContactRecord[] {
    return [...this.committed.values()];
  }

  async findById(id: string): Promise<ContactRecord | null> {
    return this.source.get(id) ?? null;
  }

  async findLiveByClient(clientId: string): Promise<ContactRecord[]> {
    return [...this.source.values()].filter((c) => c.clientId === clientId && c.deletedAt === null);
  }

  async findArchivedAt(clientId: string, deletedAt: Date): Promise<ContactRecord[]> {
    return [...this.source.values()].filter(
      (c) => c.clientId === clientId && c.deletedAt?.getTime() === deletedAt.getTime(),
    );
  }

  async findOtherPrimaries(clientId: string, exceptId: string | null): Promise<ContactRecord[]> {
    return [...this.source.values()].filter(
      (c) => c.clientId === clientId && c.isPrimary && c.deletedAt === null && c.id !== exceptId,
    );
  }

  /** The partial unique `contact_one_primary`, checked on every write like the database does. */
  private assertOnePrimary(record: ContactRecord): void {
    if (!record.isPrimary || record.deletedAt) return;
    const clash = [...this.pending.values()].some(
      (c) =>
        c.clientId === record.clientId && c.id !== record.id && c.isPrimary && c.deletedAt === null,
    );
    if (clash) throw new Error('contact_one_primary violated');
  }

  async insert(record: ContactRecord): Promise<void> {
    this.uow.assertActive('ContactRepository.insert');
    this.assertOnePrimary(record);
    this.pending.set(record.id, record);
  }

  async update(record: ContactRecord): Promise<void> {
    this.uow.assertActive('ContactRepository.update');
    this.assertOnePrimary(record);
    this.pending.set(record.id, record);
  }

  async archive(id: string, at: Date): Promise<void> {
    this.uow.assertActive('ContactRepository.archive');
    const row = this.pending.get(id);
    if (row) this.pending.set(id, { ...row, deletedAt: at, isPrimary: false, updatedAt: at });
  }

  async archiveLiveOfClient(clientId: string, at: Date): Promise<ContactRecord[]> {
    this.uow.assertActive('ContactRepository.archiveLiveOfClient');
    const live = await this.findLiveByClient(clientId);
    for (const row of live) this.pending.set(row.id, { ...row, deletedAt: at, updatedAt: at });
    return live.map((row) => ({ ...row, deletedAt: at, updatedAt: at }));
  }

  async restoreMany(ids: readonly string[], at: Date): Promise<void> {
    this.uow.assertActive('ContactRepository.restoreMany');
    for (const id of ids) {
      const row = this.pending.get(id);
      if (row) this.pending.set(id, { ...row, deletedAt: null, updatedAt: at });
    }
  }

  async list(clientId: string, query: ListQuery): Promise<Paginated<ContactRecord>> {
    this.listQueries.push({ clientId, query });
    const rows = sortContacts(
      [...this.source.values()].filter(
        (c) =>
          c.clientId === clientId &&
          (query.archived === 'include' ||
            (query.archived === 'only' ? c.deletedAt !== null : c.deletedAt === null)),
      ),
    );
    return paginated(rows, rows.length, query);
  }

  async search(
    q: string | undefined,
    clientId: string | undefined,
    limit: number,
  ): Promise<ContactRecord[]> {
    const needle = q?.toLowerCase();
    const rows = [...this.source.values()].filter(
      (c) =>
        c.deletedAt === null &&
        this.clients.get(c.clientId)?.deletedAt === null &&
        (clientId === undefined || c.clientId === clientId) &&
        (!needle || c.fullName.toLowerCase().includes(needle)),
    );
    return sortContacts(rows).slice(0, limit);
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
