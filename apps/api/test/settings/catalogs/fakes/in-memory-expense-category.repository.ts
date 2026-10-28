import type { ExpenseCategoryRepository } from '../../../../src/modules/settings/application/ports/expense-category.repository.port';
import type { ExpenseCategory } from '../../../../src/modules/settings/domain/expense-category';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/** Fake `ExpenseCategoryRepository`, keyed by id, with the unit-of-work commit and rollback semantics. */
export class InMemoryExpenseCategoryRepository
  implements ExpenseCategoryRepository, TransactionParticipant
{
  private committed = new Map<string, ExpenseCategory>();
  private pending = new Map<string, ExpenseCategory>();

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    seed: readonly ExpenseCategory[] = [],
  ) {
    uow.enlist(this);
    for (const row of seed) this.committed.set(row.id, { ...row });
  }

  get rows(): ReadonlyMap<string, ExpenseCategory> {
    return this.committed;
  }

  private get store(): Map<string, ExpenseCategory> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  async list(): Promise<ExpenseCategory[]> {
    return [...this.store.values()].map((row) => ({ ...row }));
  }

  async findById(id: string): Promise<ExpenseCategory | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async insert(category: ExpenseCategory): Promise<void> {
    this.uow.assertActive('ExpenseCategoryRepository.insert');
    this.pending.set(category.id, { ...category });
  }

  async update(category: ExpenseCategory): Promise<void> {
    this.uow.assertActive('ExpenseCategoryRepository.update');
    if (!this.pending.has(category.id)) throw new Error(`no expense category ${category.id}`);
    this.pending.set(category.id, { ...category });
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
