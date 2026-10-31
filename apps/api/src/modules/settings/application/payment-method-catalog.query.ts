import type { PaymentMethodRepository } from './ports/payment-method.repository.port';

/**
 * Tells whether a payment method can be used and whether it requires a reference. Exported for BE-3's payments.
 * Read-only: it never writes and carries no `can()` (reference catalog read, DT-71).
 */
export class PaymentMethodCatalogQuery {
  constructor(private readonly methods: PaymentMethodRepository) {}

  async activeMethod(id: string): Promise<{ id: string; requiresReference: boolean } | null> {
    const method = await this.methods.findById(id);
    return method?.active ? { id: method.id, requiresReference: method.requiresReference } : null;
  }
}
