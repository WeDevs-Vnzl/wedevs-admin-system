import { describe, expect, it } from 'vitest';
import type {
  PaymentProviderPort,
  ProviderEventKind,
  ProviderPayment,
} from '../../../src/modules/integrations/application/ports/payment-provider.port';
import {
  NotFoundError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../../src/shared/domain';

export interface SignedDelivery {
  readonly rawBody: string;
  readonly headers: Record<string, string>;
}

export interface PaymentProviderHarness {
  readonly provider: PaymentProviderPort;
  /** A delivery the provider accepts, with the event it must decode to. */
  validDelivery(): SignedDelivery & {
    readonly expected: {
      readonly eventId: string;
      readonly kind: ProviderEventKind;
      readonly paymentId: string | null;
    };
  };
  /** The same delivery with its body altered after signing. */
  tampered(delivery: SignedDelivery): SignedDelivery;
  /** A payment `retrievePayment` resolves. */
  readonly knownPayment: ProviderPayment;
  readonly unknownPaymentId: string;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Contract of `PaymentProviderPort` (A7). The fake passes it now; the Stripe adapter runs it later against a
 * scripted HTTP client, with no network.
 */
export function paymentProviderContract(
  name: string,
  factory: () => Promise<PaymentProviderHarness> | PaymentProviderHarness,
): void {
  describe(`PaymentProviderPort contract: ${name}`, () => {
    it('decodes a correctly signed event', async () => {
      const h = await factory();
      const { expected, ...delivery } = h.validDelivery();
      const event = h.provider.verifyEvent(delivery.rawBody, delivery.headers);
      expect(event.eventId).toBe(expected.eventId);
      expect(event.kind).toBe(expected.kind);
      expect(event.paymentId).toBe(expected.paymentId);
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(typeof event.type).toBe('string');
    });

    it('accepts the raw body as bytes', async () => {
      const h = await factory();
      const { expected, ...delivery } = h.validDelivery();
      const event = h.provider.verifyEvent(Buffer.from(delivery.rawBody), delivery.headers);
      expect(event.eventId).toBe(expected.eventId);
    });

    it('refuses a body altered after signing', async () => {
      const h = await factory();
      const { expected: _expected, ...delivery } = h.validDelivery();
      const bad = h.tampered(delivery);
      expect(() => h.provider.verifyEvent(bad.rawBody, bad.headers)).toThrow(UnauthenticatedError);
    });

    it('refuses a missing or wrong signature', async () => {
      const h = await factory();
      const { expected: _expected, ...delivery } = h.validDelivery();
      expect(() => h.provider.verifyEvent(delivery.rawBody, {})).toThrow(UnauthenticatedError);
      const wrong = Object.fromEntries(
        Object.keys(delivery.headers).map((key) => [key, 'invalid']),
      );
      expect(() => h.provider.verifyEvent(delivery.rawBody, wrong)).toThrow(UnauthenticatedError);
    });

    it('retrieves a payment with decimal-string money', async () => {
      const h = await factory();
      const payment = await h.provider.retrievePayment(h.knownPayment.id);
      expect(payment.id).toBe(h.knownPayment.id);
      expect(payment.amount).toMatch(DECIMAL);
      if (payment.fee !== null) expect(payment.fee).toMatch(DECIMAL);
      expect(payment.currency).toMatch(/^[A-Z]{3}$/);
      expect(payment.paidAt).toBeInstanceOf(Date);
    });

    it('answers NotFound for an unknown payment', async () => {
      const h = await factory();
      await expect(h.provider.retrievePayment(h.unknownPaymentId)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    const link = (idempotencyKey: string, amount = '25.00') => ({
      idempotencyKey,
      amount,
      currency: 'USD',
      description: 'Invoice link',
      metadata: { invoiceId: 'inv-1', linkId: idempotencyKey },
    });

    it('creates a link with an external id and an https url', async () => {
      const h = await factory();
      const created = await h.provider.createPaymentLink(link('invoice-link:a'));
      expect(created.externalId.length).toBeGreaterThan(0);
      expect(created.url).toMatch(/^https:\/\//);
    });

    it('returns the same link for the same idempotency key and a new one for another', async () => {
      const h = await factory();
      const first = await h.provider.createPaymentLink(link('invoice-link:a'));
      const again = await h.provider.createPaymentLink(link('invoice-link:a'));
      const other = await h.provider.createPaymentLink(link('invoice-link:b'));
      expect(again).toEqual(first);
      expect(other.externalId).not.toBe(first.externalId);
    });

    it('carries the smallest and the largest amount without precision loss', async () => {
      const h = await factory();
      await expect(
        h.provider.createPaymentLink(link('invoice-link:min', '0.50')),
      ).resolves.toBeDefined();
      await expect(
        h.provider.createPaymentLink(link('invoice-link:max', '99999999.99')),
      ).resolves.toBeDefined();
    });

    it('refuses an amount finer than the currency instead of rounding it', async () => {
      const h = await factory();
      await expect(
        h.provider.createPaymentLink(link('invoice-link:fine', '10.005')),
      ).rejects.toBeInstanceOf(ValidationFailedError);
    });

    it('deactivates a link, twice without failing', async () => {
      const h = await factory();
      const created = await h.provider.createPaymentLink(link('invoice-link:d'));
      await h.provider.deactivatePaymentLink(created.externalId);
      await expect(h.provider.deactivatePaymentLink(created.externalId)).resolves.toBeUndefined();
    });

    it('answers NotFound when deactivating an unknown link', async () => {
      const h = await factory();
      await expect(h.provider.deactivatePaymentLink('plink_unknown')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
}
