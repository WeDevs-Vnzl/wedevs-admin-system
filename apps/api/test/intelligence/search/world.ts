import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import type {
  EntryComparison,
  SearchCriteria,
  SearchHit,
  SearchIndexMaintenancePort,
  SearchRankedResult,
  SearchReadPort,
} from '../../../src/modules/intelligence/application/ports/search-read.port';
import type { SearchableEntityType } from '../../../src/modules/intelligence/domain/search-query';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../src/shared/application/ports/search-index.port';
import {
  SearchReindexRegistry,
  type SearchReindexSource,
} from '../../../src/shared/application/ports/search-reindex.port';
import type { EntityType, UserRole } from '../../../src/shared/domain/enums';
import {
  InMemoryUnitOfWork,
  type TransactionParticipant,
} from '../../support/fakes/in-memory-unit-of-work';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `clerk_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const hit = (
  entityType: SearchableEntityType,
  entityId: string,
  over: Partial<SearchHit> = {},
): SearchHit => ({
  entityType,
  entityId,
  code: null,
  title: entityId,
  subtitle: null,
  status: null,
  archived: false,
  ...over,
});

/** Fake read port: returns what the test configured and records the criteria it was asked with. */
export class FakeSearchRead implements SearchReadPort {
  exact: SearchHit | null = null;
  result: SearchRankedResult = { hits: [], totals: {} };
  readonly exactCalls: SearchCriteria[] = [];
  readonly searchCalls: { criteria: SearchCriteria; limit: number }[] = [];

  async findExact(criteria: SearchCriteria): Promise<SearchHit | null> {
    this.exactCalls.push(criteria);
    return this.exact;
  }

  async search(criteria: SearchCriteria, limit: number): Promise<SearchRankedResult> {
    this.searchCalls.push({ criteria, limit });
    return this.result;
  }
}

const key = (type: EntityType, id: string) => `${type}:${id}`;

/**
 * One in-memory index that is both the write port and the maintenance port, buffered per unit of work
 * like `InMemorySearchIndex` (which has no delete and no listing, so the maintenance side needs its own).
 */
export class InMemoryIndex
  implements SearchIndexPort, SearchIndexMaintenancePort, TransactionParticipant
{
  private committed = new Map<string, SearchIndexEntry>();
  private pending = new Map<string, SearchIndexEntry>();
  /** Writes that reached `upsert`, to prove an unchanged entry is not written again. */
  upserts = 0;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  get(type: EntityType, id: string): SearchIndexEntry | undefined {
    return this.committed.get(key(type, id));
  }

  get size(): number {
    return this.committed.size;
  }

  /** Test setup: an entry already in the index. */
  seed(entry: SearchIndexEntry): void {
    this.committed.set(key(entry.entityType, entry.entityId), entry);
    this.pending = new Map(this.committed);
  }

  async upsert(entry: SearchIndexEntry): Promise<void> {
    this.uow.assertActive('SearchIndexPort.upsert');
    this.upserts += 1;
    this.pending.set(key(entry.entityType, entry.entityId), { ...entry });
  }

  async upsertMany(): Promise<void> {
    throw new Error('not used by the reindex');
  }

  async setArchived(): Promise<void> {
    throw new Error('not used by the reindex');
  }

  async setTexts(): Promise<number> {
    throw new Error('not used by the reindex');
  }

  async compare(entry: SearchIndexEntry): Promise<EntryComparison> {
    const stored = this.pending.get(key(entry.entityType, entry.entityId));
    if (!stored) return 'missing';
    return JSON.stringify(stored) === JSON.stringify(entry) ? 'same' : 'different';
  }

  async listEntityIds(type: EntityType, afterId: string | null, take: number): Promise<string[]> {
    return [...this.pending.values()]
      .filter((row) => row.entityType === type)
      .map((row) => row.entityId)
      .filter((id) => afterId === null || id > afterId)
      .sort()
      .slice(0, take);
  }

  async remove(type: EntityType, id: string): Promise<boolean> {
    this.uow.assertActive('SearchIndexMaintenancePort.remove');
    return this.pending.delete(key(type, id));
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

/** A reindex source over a map of rows; `entryOf` returns `null` for a row that is gone. */
export class MapSource implements SearchReindexSource {
  readonly rows = new Map<string, SearchIndexEntry>();
  readonly entryCalls: string[] = [];
  failWith: Error | null = null;

  constructor(readonly entityType: EntityType) {}

  add(entry: Omit<SearchIndexEntry, 'entityType'>): void {
    this.rows.set(entry.entityId, { entityType: this.entityType, ...entry });
  }

  async pageIds(afterId: string | null, take: number): Promise<string[]> {
    return [...this.rows.keys()]
      .sort()
      .filter((id) => afterId === null || id > afterId)
      .slice(0, take);
  }

  async entryOf(id: string): Promise<SearchIndexEntry | null> {
    this.entryCalls.push(id);
    if (this.failWith) throw this.failWith;
    return this.rows.get(id) ?? null;
  }
}

export const entry = (
  entityType: EntityType,
  entityId: string,
  over: Partial<SearchIndexEntry> = {},
): SearchIndexEntry => ({
  entityType,
  entityId,
  code: null,
  title: entityId,
  subtitle: null,
  body: null,
  status: null,
  archived: false,
  ...over,
});

export function buildSearchWorld() {
  const uow = new InMemoryUnitOfWork();
  const index = new InMemoryIndex(uow);
  const registry = new SearchReindexRegistry();
  const read = new FakeSearchRead();
  return { uow, index, registry, read, authorization: new MatrixAuthorization() };
}
