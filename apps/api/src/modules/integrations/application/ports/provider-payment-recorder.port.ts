import type { IntegrationProvider } from '../../domain/integration-event';

export const PROVIDER_PAYMENT_RECORDER = Symbol('PROVIDER_PAYMENT_RECORDER');

export interface RecordProviderPaymentInput {
  readonly provider: IntegrationProvider;
  /** The event that carried the payment; finance links it to the payment for audit. */
  readonly eventId: string;
  /** The provider's payment id: unique per provider on `Payment`. */
  readonly externalId: string;
  readonly clientId: string;
  readonly invoiceId: string | null;
  /** Link that produced the payment, marked `COMPLETED` inside the same unit of work (A13). */
  readonly linkId: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly fee: string | null;
  readonly receivedAt: Date;
}

export interface RecordedProviderPayment {
  readonly paymentId: string;
  /** False when the payment already existed (same provider and external id). */
  readonly created: boolean;
}

/**
 * Finance's `RecordProviderPayment` (A6, 2.4): a `PENDIENTE_VERIFICACION`, unallocated payment under the
 * money lock order. Integrations calls it; it never writes payments itself (C17, C18).
 */
export interface ProviderPaymentRecorderPort {
  record(input: RecordProviderPaymentInput): Promise<RecordedProviderPayment>;
}
