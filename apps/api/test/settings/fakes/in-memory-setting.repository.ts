import type {
  SettingRecord,
  SettingRepository,
} from '../../../src/modules/settings/application/ports/setting.repository';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../support/fakes/in-memory-unit-of-work';

/**
 * Fake `SettingRepository`. Writes made inside a unit of work become visible on commit and are discarded
 * on rollback, like the adapter. `saveCount` counts every write, so tests can assert "nothing written".
 */
export class InMemorySettingRepository implements SettingRepository, TransactionParticipant {
  private committed = new Map<string, unknown>();
  private pending = new Map<string, unknown>();
  saveCount = 0;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  /** Committed rows only, for assertions after the call returned or threw. */
  get rows(): ReadonlyMap<string, unknown> {
    return this.committed;
  }

  seed(key: string, value: unknown): void {
    this.committed.set(key, value);
  }

  async find(key: string): Promise<SettingRecord | null> {
    const source = this.uow.isActive ? this.pending : this.committed;
    return source.has(key) ? { key, value: source.get(key) } : null;
  }

  async save(key: string, value: unknown): Promise<void> {
    this.uow.assertActive('SettingRepository.save');
    this.saveCount += 1;
    this.pending.set(key, structuredClone(value));
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
