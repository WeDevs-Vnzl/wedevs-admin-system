import type { PaymentMethodRepository } from '../../../../src/modules/settings/application/ports/payment-method.repository.port';
import type { PaymentMethod } from '../../../../src/modules/settings/domain/payment-method';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

/** Fake `PaymentMethodRepository`, keyed by id, with the unit-of-work commit and rollback semantics. */
export class InMemoryPaymentMethodRepository
  implements PaymentMethodRepository, TransactionParticipant
{
  private committed = new Map<string, PaymentMethod>();
  private pending = new Map<string, PaymentMethod>();

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    seed: readonly PaymentMethod[] = [],
  ) {
    uow.enlist(this);
    for (const row of seed) this.committed.set(row.id, { ...row });
  }

  get rows(): ReadonlyMap<string, PaymentMethod> {
    return this.committed;
  }

  private get store(): Map<string, PaymentMethod> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  async list(): Promise<PaymentMethod[]> {
    return [...this.store.values()].map((row) => ({ ...row }));
  }

  async findById(id: string): Promise<PaymentMethod | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async insert(method: PaymentMethod): Promise<void> {
    this.uow.assertActive('PaymentMethodRepository.insert');
    this.pending.set(method.id, { ...method });
  }

  async update(method: PaymentMethod): Promise<void> {
    this.uow.assertActive('PaymentMethodRepository.update');
    if (!this.pending.has(method.id)) throw new Error(`no payment method ${method.id}`);
    this.pending.set(method.id, { ...method });
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
