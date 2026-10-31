import type { CurrentUser } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';

export const PAYMENT_REFERENCES = Symbol('PAYMENT_REFERENCES');
export const PAYMENT_RECEIPT_FILES = Symbol('PAYMENT_RECEIPT_FILES');

export interface PaymentAccountRef {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly active: boolean;
}

export interface PaymentMethodRule {
  readonly id: string;
  /** The method asks for a reference (`PaymentMethod.requiresReference`, §8.6). */
  readonly requiresReference: boolean;
}

/**
 * What a payment points at, checked against the database (a client id is never trusted, C14). Every method
 * answers `null` for an unknown, archived or (method) inactive row; the use case throws its own error.
 * Valid inside the caller's unit of work, after it took the row locks.
 */
export interface PaymentReferencesPort {
  liveClient(id: string): Promise<EntityRef | null>;
  /** A company account that is not archived; the use case checks `active`. */
  account(id: string): Promise<PaymentAccountRef | null>;
  activeMethod(id: string): Promise<PaymentMethodRule | null>;
}

export interface ReservedPaymentReceipt {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Claims a file as a payment receipt (C23). Valid only inside the payment's unit of work: it takes the file row
 * lock a concurrent delete also takes. Throws `NOT_FOUND` for a file that is unknown, not `READY`, or neither
 * the caller's own upload nor claimed by a resource the caller can read.
 */
export interface PaymentReceiptFilesPort {
  reserve(actor: CurrentUser, fileId: string): Promise<ReservedPaymentReceipt>;
}
