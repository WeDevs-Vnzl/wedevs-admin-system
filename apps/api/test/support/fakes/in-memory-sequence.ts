import type {
  SequenceName,
  SequencePort,
} from '../../../src/shared/application/ports/sequence.port';
import type { InMemoryUnitOfWork, TransactionParticipant } from './in-memory-unit-of-work';

const PAD = 4;

/** Fake `SequencePort`: counters start at 0, increments commit with the unit of work. */
export class InMemorySequence implements SequencePort, TransactionParticipant {
  private committed = new Map<SequenceName, number>();
  private pending = new Map<SequenceName, number>();

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  /** Test helper: set the last allocated value of a sequence. */
  seed(name: SequenceName, value: number): void {
    this.committed.set(name, value);
  }

  async next(name: SequenceName): Promise<string> {
    this.uow.assertActive('SequencePort.next');
    const value = (this.pending.get(name) ?? this.committed.get(name) ?? 0) + 1;
    this.pending.set(name, value);
    return `${name}-${String(value).padStart(PAD, '0')}`;
  }

  begin(): void {
    this.pending = new Map();
  }

  commit(): void {
    for (const [name, value] of this.pending) this.committed.set(name, value);
    this.pending = new Map();
  }

  rollback(): void {
    this.pending = new Map();
  }
}
