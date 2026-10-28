import type { TechnologyRecord } from '../../../../src/modules/settings/domain/technology';
import type { TechnologyRepository } from '../../../../src/modules/settings/application/ports/technology.repository.port';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/**
 * Fake `TechnologyRepository`. Writes made inside a unit of work become visible on commit and are
 * discarded on rollback, like the adapter. `writeCount` counts every write, so tests can assert that a
 * rejected command wrote nothing.
 */
export class InMemoryTechnologyRepository implements TechnologyRepository, TransactionParticipant {
  private committed = new Map<string, TechnologyRecord>();
  private pending = new Map<string, TechnologyRecord>();
  writeCount = 0;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  /** Committed rows only, for assertions after the call returned or threw. */
  get rows(): readonly TechnologyRecord[] {
    return [...this.committed.values()];
  }

  seed(...records: TechnologyRecord[]): void {
    for (const record of records) this.committed.set(record.id, structuredClone(record));
  }

  private view(): Map<string, TechnologyRecord> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  async findAll(): Promise<TechnologyRecord[]> {
    return [...this.view().values()].map((row) => structuredClone(row));
  }

  async findById(id: string): Promise<TechnologyRecord | null> {
    const row = this.view().get(id);
    return row ? structuredClone(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<TechnologyRecord[]> {
    return ids
      .map((id) => this.view().get(id))
      .filter((row): row is TechnologyRecord => row !== undefined)
      .map((row) => structuredClone(row));
  }

  async insert(record: TechnologyRecord): Promise<void> {
    this.uow.assertActive('TechnologyRepository.insert');
    this.writeCount += 1;
    this.pending.set(record.id, structuredClone(record));
  }

  async update(record: TechnologyRecord): Promise<void> {
    this.uow.assertActive('TechnologyRepository.update');
    this.writeCount += 1;
    if (!this.pending.has(record.id)) throw new Error(`no technology ${record.id}`);
    this.pending.set(record.id, structuredClone(record));
  }

  async delete(id: string): Promise<void> {
    this.uow.assertActive('TechnologyRepository.delete');
    this.writeCount += 1;
    this.pending.delete(id);
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
