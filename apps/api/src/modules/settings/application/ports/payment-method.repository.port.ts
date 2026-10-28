import type { PaymentMethod } from '../../domain/payment-method';

/**
 * Access to the `PaymentMethod` table. Reads and writes run in the caller's unit of work when one is open.
 * Rows are never deleted (C19); a retired method is written with `active: false`.
 */
export interface PaymentMethodRepository {
  /** Every row, active or not; the use case filters, orders and checks uniqueness. */
  list(): Promise<PaymentMethod[]>;
  /** `null` when no row has the id. */
  findById(id: string): Promise<PaymentMethod | null>;
  /** Inserts a new row. A code that is already stored throws `ConflictError` (field `code`). */
  insert(method: PaymentMethod): Promise<void>;
  /** Writes the editable fields of an existing row; the code never changes. */
  update(method: PaymentMethod): Promise<void>;
}

export const PAYMENT_METHOD_REPOSITORY = Symbol('PAYMENT_METHOD_REPOSITORY');
