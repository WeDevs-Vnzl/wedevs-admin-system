/** DT-110 token; bound to the Stripe adapter (or a fake) only in `integrations.module.ts`. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** What the webhook handler does with an event, decided by the adapter from the provider's own type. */
export type ProviderEventKind = 'PAYMENT_RECEIVED' | 'REFUND' | 'OTHER';

/** A signature-verified provider event, translated to an application model (no SDK type crosses the port). */
export interface ProviderEvent {
  readonly eventId: string;
  /** The provider's own event type, kept for the event store and logs. */
  readonly type: string;
  readonly kind: ProviderEventKind;
  readonly occurredAt: Date;
  /** Provider id of the payment the event is about, when it has one. */
  readonly paymentId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

/** A payment as the provider settled it. Amounts are decimal strings in `currency` (C15, DT-194). */
export interface ProviderPayment {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  /** Provider fee from the balance transaction, in `currency`; null while the provider has none. */
  readonly fee: string | null;
  readonly paidAt: Date;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CreatePaymentLinkInput {
  /** The same key returns the same link and never a second one (`invoice-link:{linkId}`). */
  readonly idempotencyKey: string;
  /** Decimal string in `currency`; the adapter converts to minor units without losing precision. */
  readonly amount: string;
  readonly currency: string;
  readonly description: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CreatedPaymentLink {
  readonly externalId: string;
  readonly url: string;
}

export type ProviderHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

/**
 * Stripe-shaped inbound payments and outbound payment links. Adapters translate provider errors to
 * `DomainError`s: a bad or missing signature is `UnauthenticatedError`, an unknown payment `NotFoundError`.
 */
export interface PaymentProviderPort {
  /** Verifies the signature of the raw body before anything is parsed. Throws on a bad signature. */
  verifyEvent(rawBody: string | Uint8Array, headers: ProviderHeaders): ProviderEvent;
  retrievePayment(paymentId: string): Promise<ProviderPayment>;
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatedPaymentLink>;
  /** Idempotent: deactivating an already inactive link succeeds. */
  deactivatePaymentLink(externalId: string): Promise<void>;
}
