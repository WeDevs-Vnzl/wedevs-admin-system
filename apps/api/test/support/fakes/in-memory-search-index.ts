import type { EntityType } from '../../../src/shared/domain/enums';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../src/shared/application/ports/search-index.port';
import type { InMemoryUnitOfWork, TransactionParticipant } from './in-memory-unit-of-work';

const key = (type: EntityType, id: string) => `${type}:${id}`;

/** Fake `SearchIndexPort`: buffered per unit of work, throws outside `run`. Bodies are not truncated. */
export class InMemorySearchIndex implements SearchIndexPort, TransactionParticipant {
  private committed = new Map<string, SearchIndexEntry>();
  private pending = new Map<string, SearchIndexEntry>();

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  /** Committed entry, if any. */
  get(type: EntityType, id: string): SearchIndexEntry | undefined {
    return this.committed.get(key(type, id));
  }

  get size(): number {
    return this.committed.size;
  }

  async upsert(entry: SearchIndexEntry): Promise<void> {
    this.uow.assertActive('SearchIndexPort.upsert');
    this.pending.set(key(entry.entityType, entry.entityId), { ...entry });
  }

  async setArchived(entityType: EntityType, entityId: string, archived: boolean): Promise<void> {
    this.uow.assertActive('SearchIndexPort.setArchived');
    const k = key(entityType, entityId);
    const current = this.pending.get(k);
    if (current) this.pending.set(k, { ...current, archived });
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
