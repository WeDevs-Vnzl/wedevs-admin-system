import type { CurrencyRepository } from '../../../../src/modules/settings/application/ports/currency.repository.port';
import type { Currency } from '../../../../src/modules/settings/domain/currency';
import { ConflictError } from '../../../../src/shared/domain/domain-error';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/**
 * Fake `CurrencyRepository`. Writes made inside a unit of work become visible on commit and are discarded on
 * rollback, like the adapter. A duplicate code throws `ConflictError`, as the adapter's unique violation does.
 */
export class InMemoryCurrencyRepository implements CurrencyRepository, TransactionParticipant {
  private committed = new Map<string, Currency>();
  private pending = new Map<string, Currency>();

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    seed: readonly Currency[] = [],
  ) {
    uow.enlist(this);
    for (const row of seed) this.committed.set(row.code, { ...row });
  }

  /** Committed rows only, for assertions after the call returned or threw. */
  get rows(): ReadonlyMap<string, Currency> {
    return this.committed;
  }

  private get store(): Map<string, Currency> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  async list(): Promise<Currency[]> {
    return [...this.store.values()].map((row) => ({ ...row }));
  }

  async findByCode(code: string): Promise<Currency | null> {
    const row = this.store.get(code);
    return row ? { ...row } : null;
  }

  async insert(currency: Currency): Promise<void> {
    this.uow.assertActive('CurrencyRepository.insert');
    if (this.pending.has(currency.code)) {
      throw new ConflictError({ fieldErrors: { code: ['catalogs.currencies.errors.codeTaken'] } });
    }
    this.pending.set(currency.code, { ...currency });
  }

  async update(currency: Currency): Promise<void> {
    this.uow.assertActive('CurrencyRepository.update');
    if (!this.pending.has(currency.code)) throw new Error(`no currency ${currency.code}`);
    this.pending.set(currency.code, { ...currency });
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
