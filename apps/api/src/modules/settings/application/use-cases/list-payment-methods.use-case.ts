import type { CurrentUser } from '../../../../shared/application/current-user';
import { sortPaymentMethods, type PaymentMethod } from '../../domain/payment-method';
import type { PaymentMethodRepository } from '../ports/payment-method.repository.port';
import type { ListCatalogInput } from './list-currencies.use-case';

/**
 * Lists the payment methods (PRD §8.15): active ones for pickers, every one with `includeInactive` for Settings.
 * Authorization is the route's `@Authenticated()` declaration (DT-71: reference catalog read).
 */
export class ListPaymentMethods {
  constructor(private readonly methods: PaymentMethodRepository) {}

  async execute(_actor: CurrentUser, input: ListCatalogInput): Promise<PaymentMethod[]> {
    const rows = await this.methods.list();
    return sortPaymentMethods(rows.filter((row) => input.includeInactive || row.active));
  }
}
