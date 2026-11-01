import {
  ROW_LOCK_ORDER,
  type RowLockClass,
  type RowLockSet,
  type RowLocksPort,
} from '../../../src/shared/application/ports/row-locks.port';
import type { InMemoryUnitOfWork, TransactionParticipant } from './in-memory-unit-of-work';

/**
 * Fake `RowLocksPort`: same rules as the adapter (unit of work only, a second call may only re-lock a
 * subset) and a record of the order the rows would be taken in, for use-case tests.
 */
export class InMemoryRowLocks implements RowLocksPort, TransactionParticipant {
  private held: Map<RowLockClass, Set<string>> | undefined;
  /** Rows of the current or last unit of work, in the order the adapter would lock them. */
  acquired: { readonly rowClass: RowLockClass; readonly id: string }[] = [];

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  async lock(set: RowLockSet): Promise<void> {
    this.uow.assertActive('RowLocksPort.lock');
    const requested = normalize(set);
    if (this.held) {
      for (const [rowClass, ids] of requested) {
        const have = this.held.get(rowClass);
        if (ids.some((id) => !have?.has(id))) {
          throw new Error(
            `RowLocksPort: a second lock call in the same transaction adds ${rowClass} rows; lock every row up front`,
          );
        }
      }
      return;
    }
    this.held = new Map([...requested].map(([rowClass, ids]) => [rowClass, new Set(ids)]));
    for (const [rowClass, ids] of requested) {
      for (const id of ids) this.acquired.push({ rowClass, id });
    }
  }

  begin(): void {
    this.held = undefined;
    this.acquired = [];
  }

  commit(): void {
    this.held = undefined;
  }

  rollback(): void {
    this.held = undefined;
  }
}

function normalize(set: RowLockSet): [RowLockClass, string[]][] {
  const out: [RowLockClass, string[]][] = [];
  for (const rowClass of ROW_LOCK_ORDER) {
    const ids = set[rowClass];
    if (!ids || ids.length === 0) continue;
    out.push([rowClass, [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))]);
  }
  return out;
}
