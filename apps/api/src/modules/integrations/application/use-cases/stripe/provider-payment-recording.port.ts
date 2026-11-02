import type { IntegrationProvider } from '../../../domain/integration-event';

export const PROVIDER_PAYMENT_RECORDING = Symbol('PROVIDER_PAYMENT_RECORDING');

/**
 * What the webhook hands to finance for a payment it resolved: the provider payment, the client and optional
 * invoice and link it names, and the (account, method) of the mapping (DT-183). All ids were resolved by the
 * webhook use case (C14); finance checks them again under its locks.
 */
export interface RecordProviderPaymentCommand {
  readonly provider: IntegrationProvider;
  readonly eventId: string;
  readonly eventType: string;
  /** The provider's payment id, unique per provider on `Payment`. */
  readonly externalId: string;
  readonly clientId: string;
  readonly invoiceId: string | null;
  readonly linkId: string | null;
  /** Decimal string in `currency` (C15). */
  readonly amount: string;
  readonly currency: string;
  readonly fee: string | null;
  readonly receivedAt: Date;
  readonly accountId: string;
  readonly methodId: string;
}

/**
 * Finance's `RecordProviderPayment` outcomes, kept apart so the webhook can answer `duplicate` and `parked`
 * (the older `ProviderPaymentRecorderPort` only tells created from existing).
 */
export type RecordProviderPaymentOutcome =
  | { readonly outcome: 'RECORDED'; readonly paymentId: string }
  | { readonly outcome: 'EXISTING'; readonly paymentId: string }
  | { readonly outcome: 'DUPLICATE' }
  | { readonly outcome: 'PARKED'; readonly reasonCode: 'NO_RATE' };

/**
 * Declared here (DT-110) and implemented by an adapter over finance's `RecordProviderPayment`. A failure finance
 * cannot recover from is a `DomainError`; the unit of work it ran in has been rolled back.
 */
export interface ProviderPaymentRecordingPort {
  record(command: RecordProviderPaymentCommand): Promise<RecordProviderPaymentOutcome>;
}
