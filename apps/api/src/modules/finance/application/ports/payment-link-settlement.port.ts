import type { MoneyString } from '../../../../shared/domain/money';

export const PAYMENT_LINK_SETTLEMENT = Symbol('PAYMENT_LINK_SETTLEMENT');
export const PROVIDER_PAYMENT_REFERENCE = Symbol('PROVIDER_PAYMENT_REFERENCE');

/**
 * The link status writes finance makes inside its own units of work (A13, DT-199). `integrations` owns the
 * link lifecycle; finance only moves a link a payment touched, never reads or creates one. Every method runs
 * inside the caller's unit of work and answers whether a link changed (a no-op is `false`, never an error).
 */
export interface PaymentLinkSettlementPort {
  /** A13: the `ACTIVE` link of `invoiceId` becomes `COMPLETED` carrying `paymentId`. */
  complete(input: {
    readonly linkId: string;
    readonly invoiceId: string;
    readonly paymentId: string;
  }): Promise<boolean>;

  /**
   * DT-199: the `COMPLETED` link whose payment is `paymentId` and whose invoice is `invoiceId` becomes
   * `SETTLED` once the amount allocated to that invoice (invoice currency) covers the link amount; until
   * then its amount stays reserved.
   */
  settleOnAllocation(input: {
    readonly paymentId: string;
    readonly invoiceId: string;
    readonly allocatedInvoiceCurrency: MoneyString;
    /** ISO 8601 UTC. */
    readonly at: string;
  }): Promise<boolean>;

  /** DT-199: the `COMPLETED` link whose payment is `paymentId` becomes `SETTLED` when the payment is voided. */
  settleOnVoid(input: { readonly paymentId: string; readonly at: string }): Promise<boolean>;
}

/**
 * The provider identity of a payment written from an event (Δ18): `Payment.externalProvider` and
 * `Payment.externalId`, unique together. `PaymentRecord` does not carry them, so `RecordProviderPayment`
 * stamps and looks them up through this port.
 */
export interface ProviderPaymentReferencePort {
  /** The payment already recorded for the provider's payment id, if any. */
  findPaymentId(provider: string, externalId: string): Promise<string | null>;
  /** Stamps a payment inserted in the same unit of work. */
  stamp(paymentId: string, provider: string, externalId: string): Promise<void>;
}
