import type {
  RateLimitPort,
  UnlockFailureWindow,
} from '../../../../src/modules/documents/application/ports/rate-limit.port';
import type {
  NewShareAccess,
  ShareAccessLogPort,
} from '../../../../src/modules/documents/application/ports/share-access-log.port';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type StoredAccess = Mutable<NewShareAccess>;

interface Counters {
  viewCount: number;
  downloadCount: number;
  lastAccessedAt: Date | null;
}

interface State {
  rows: StoredAccess[];
  counters: Map<string, Counters>;
}

const copy = (state: State): State => ({
  rows: state.rows.map((row) => ({ ...row })),
  counters: new Map([...state.counters].map(([id, value]) => [id, { ...value }])),
});

/** `ShareAccessLog` and the stored counters in memory, with the committed/pending split of the unit of work. */
export class InMemoryShareAccessLog
  implements ShareAccessLogPort, RateLimitPort, TransactionParticipant
{
  private committed: State = { rows: [], counters: new Map() };
  private pending: State = copy(this.committed);
  /** `true` for each append made outside a unit of work: it must stay empty. */
  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  begin(): void {
    this.pending = copy(this.committed);
  }
  commit(): void {
    this.committed = this.pending;
  }
  rollback(): void {
    this.pending = copy(this.committed);
  }

  /** Committed rows. */
  get rows(): readonly StoredAccess[] {
    return this.committed.rows;
  }

  countersOf(shareLinkId: string): Counters {
    return (
      this.committed.counters.get(shareLinkId) ?? {
        viewCount: 0,
        downloadCount: 0,
        lastAccessedAt: null,
      }
    );
  }

  eventsOf(event: string): StoredAccess[] {
    return this.committed.rows.filter((row) => row.event === event);
  }

  private counters(shareLinkId: string): Counters {
    const found = this.pending.counters.get(shareLinkId);
    if (found) return found;
    const created: Counters = { viewCount: 0, downloadCount: 0, lastAccessedAt: null };
    this.pending.counters.set(shareLinkId, created);
    return created;
  }

  async append(entry: NewShareAccess): Promise<void> {
    this.uow.assertActive('ShareAccessLog.append');
    if (entry.event === 'VIEW' || entry.event === 'DOWNLOAD') {
      const counters = this.counters(entry.shareLinkId);
      if (entry.event === 'VIEW') counters.viewCount += 1;
      else counters.downloadCount += 1;
      counters.lastAccessedAt = entry.createdAt;
    }
    this.pending.rows.push({ ...entry });
  }

  async convertToUnlock(entryId: string, shareLinkId: string, at: Date): Promise<void> {
    this.uow.assertActive('ShareAccessLog.convertToUnlock');
    const row = this.pending.rows.find((candidate) => candidate.id === entryId);
    if (!row) throw new Error(`no access row ${entryId}`);
    row.event = 'UNLOCK';
    this.counters(shareLinkId).lastAccessedAt = at;
  }

  async countFailures(window: UnlockFailureWindow): Promise<number> {
    const state = this.uow.isActive ? this.pending : this.committed;
    return state.rows.filter(
      (row) =>
        row.event === 'UNLOCK_FAILED' &&
        row.shareLinkId === window.shareLinkId &&
        row.documentId === window.documentId &&
        row.ipHash === window.ipHash &&
        row.createdAt.getTime() > window.since.getTime(),
    ).length;
  }
}
