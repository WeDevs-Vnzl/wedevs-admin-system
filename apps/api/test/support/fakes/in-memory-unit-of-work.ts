import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  IsolationLevel,
  UnitOfWorkOptions,
  UnitOfWorkPort,
} from '../../../src/shared/application/ports/unit-of-work.port';

const ISOLATION_RANK: Record<IsolationLevel, number> = {
  ReadCommitted: 0,
  RepeatableRead: 1,
  Serializable: 2,
};

/** State that commits or rolls back with the unit of work (activity buffer, sequence counters). */
export interface TransactionParticipant {
  begin(): void;
  commit(): void;
  rollback(): void;
}

/**
 * Fake `UnitOfWorkPort`. A nested `run` joins the outer one unless it requests a stricter isolation (then it throws, as the adapter). When `work` throws, every enlisted
 * participant discards what it buffered, like a database rollback.
 */
export class InMemoryUnitOfWork implements UnitOfWorkPort {
  /** Marks the async context that belongs to the open transaction (so nesting is per call chain). */
  private readonly context = new AsyncLocalStorage<IsolationLevel>();
  private open = false;
  private readonly participants: TransactionParticipant[] = [];
  /** Options of the last outermost `run`, for tests that assert the isolation level. */
  lastOptions: UnitOfWorkOptions | undefined;

  get isActive(): boolean {
    return this.context.getStore() !== undefined;
  }

  enlist(participant: TransactionParticipant): void {
    this.participants.push(participant);
  }

  assertActive(what: string): void {
    if (!this.isActive) throw new Error(`${what} is only valid inside UnitOfWorkPort.run`);
  }

  async run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T> {
    const isolation = options?.isolation ?? 'ReadCommitted';
    const active = this.context.getStore();
    if (active !== undefined) {
      if (ISOLATION_RANK[isolation] > ISOLATION_RANK[active]) {
        throw new Error(
          `Nested unit of work requests ${isolation} inside an outer ${active} transaction; open the outermost unit of work with ${isolation}`,
        );
      }
      return work();
    }
    if (this.open) {
      throw new Error(
        'InMemoryUnitOfWork: a concurrent top-level run is not supported; await the first run',
      );
    }
    this.lastOptions = options;
    this.open = true;
    for (const participant of this.participants) participant.begin();
    try {
      const result = await this.context.run(isolation, work);
      for (const participant of this.participants) participant.commit();
      return result;
    } catch (error) {
      for (const participant of this.participants) participant.rollback();
      throw error;
    } finally {
      this.open = false;
    }
  }
}
