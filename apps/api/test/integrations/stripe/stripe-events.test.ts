import { describe, expect, it } from 'vitest';
import { createStripePaymentProvider } from '../../../src/modules/integrations/infrastructure/stripe/stripe-payment-provider';
import { UnauthenticatedError } from '../../../src/shared/domain';
import { ScriptedStripeFetch, signPayload, testApiKey, testWebhookSecret } from './scripted-stripe';

const NOW = new Date('2026-11-02T12:00:00.000Z');

function build() {
  const script = new ScriptedStripeFetch();
  const secret = testWebhookSecret();
  const provider = createStripePaymentProvider({
    apiKey: testApiKey(),
    webhookSecret: secret,
    httpClient: script.httpClient(),
    returnUrl: 'https://app.example.test/pay/done',
    clock: () => NOW,
  });
  return { script, secret, provider };
}

const event = (type: string, object: unknown) =>
  JSON.stringify({ id: 'evt_1', object: 'event', type, created: 1_793_000_000, data: { object } });

describe('StripePaymentProvider.verifyEvent', () => {
  it('translates payment_intent.succeeded with its metadata', () => {
    const { provider, secret } = build();
    const body = event('payment_intent.succeeded', {
      id: 'pi_1',
      object: 'payment_intent',
      metadata: { invoiceId: 'inv-1', linkId: 'lnk-1' },
    });
    const out = provider.verifyEvent(body, {
      'stripe-signature': signPayload(body, secret, NOW.getTime()),
    });
    expect(out).toEqual({
      eventId: 'evt_1',
      type: 'payment_intent.succeeded',
      kind: 'PAYMENT_RECEIVED',
      occurredAt: new Date(1_793_000_000 * 1000),
      paymentId: 'pi_1',
      metadata: { invoiceId: 'inv-1', linkId: 'lnk-1' },
    });
  });

  it('translates a paid checkout.session.completed to its payment intent', () => {
    const { provider, secret } = build();
    const body = event('checkout.session.completed', {
      id: 'cs_1',
      object: 'checkout.session',
      payment_status: 'paid',
      payment_intent: 'pi_2',
      metadata: { invoiceId: 'inv-2', linkId: 'lnk-2' },
    });
    const out = provider.verifyEvent(body, {
      'stripe-signature': signPayload(body, secret, NOW.getTime()),
    });
    expect(out.kind).toBe('PAYMENT_RECEIVED');
    expect(out.paymentId).toBe('pi_2');
    expect(out.metadata).toEqual({ invoiceId: 'inv-2', linkId: 'lnk-2' });
  });

  it('does not treat an unpaid completed session as a payment', () => {
    const { provider, secret } = build();
    const body = event('checkout.session.completed', {
      id: 'cs_1',
      object: 'checkout.session',
      payment_status: 'unpaid',
      payment_intent: 'pi_2',
      metadata: {},
    });
    const out = provider.verifyEvent(body, {
      'stripe-signature': signPayload(body, secret, NOW.getTime()),
    });
    expect(out.kind).toBe('OTHER');
  });

  it('translates charge.refunded as a REFUND on the payment intent', () => {
    const { provider, secret } = build();
    const body = event('charge.refunded', {
      id: 'ch_1',
      object: 'charge',
      payment_intent: 'pi_3',
      metadata: {},
    });
    const out = provider.verifyEvent(body, {
      'stripe-signature': signPayload(body, secret, NOW.getTime()),
    });
    expect(out.kind).toBe('REFUND');
    expect(out.paymentId).toBe('pi_3');
  });

  it('answers OTHER for any other type', () => {
    const { provider, secret } = build();
    const body = event('customer.created', { id: 'cus_1', object: 'customer' });
    const out = provider.verifyEvent(body, {
      'stripe-signature': signPayload(body, secret, NOW.getTime()),
    });
    expect(out).toMatchObject({ kind: 'OTHER', paymentId: null, type: 'customer.created' });
  });

  it('refuses a signature made with another secret', () => {
    const { provider } = build();
    const body = event('payment_intent.succeeded', {
      id: 'pi_1',
      object: 'payment_intent',
      metadata: {},
    });
    const header = signPayload(body, testWebhookSecret(), NOW.getTime());
    expect(() => provider.verifyEvent(body, { 'stripe-signature': header })).toThrow(
      UnauthenticatedError,
    );
  });

  it('refuses a stale timestamp outside the default tolerance', () => {
    const { provider, secret } = build();
    const body = event('payment_intent.succeeded', {
      id: 'pi_1',
      object: 'payment_intent',
      metadata: {},
    });
    const stale = signPayload(body, secret, NOW.getTime() - 6 * 60 * 1000);
    expect(() => provider.verifyEvent(body, { 'stripe-signature': stale })).toThrow(
      UnauthenticatedError,
    );
    const fresh = signPayload(body, secret, NOW.getTime() - 4 * 60 * 1000);
    expect(provider.verifyEvent(body, { 'stripe-signature': fresh }).eventId).toBe('evt_1');
  });

  it('refuses before parsing: a signed-wrong body that is not JSON is Unauthenticated, not a parse error', () => {
    const { provider } = build();
    expect(() => provider.verifyEvent('not json', { 'stripe-signature': 'x' })).toThrow(
      UnauthenticatedError,
    );
  });

  it('reads the signature header case-insensitively and refuses an array of headers', () => {
    const { provider, secret } = build();
    const body = event('payment_intent.succeeded', {
      id: 'pi_1',
      object: 'payment_intent',
      metadata: {},
    });
    const header = signPayload(body, secret, NOW.getTime());
    expect(provider.verifyEvent(body, { 'Stripe-Signature': header }).eventId).toBe('evt_1');
    expect(() => provider.verifyEvent(body, { 'stripe-signature': [header, header] })).toThrow(
      UnauthenticatedError,
    );
  });

  it('opens no connection while verifying', () => {
    const { provider, secret, script } = build();
    const body = event('payment_intent.succeeded', {
      id: 'pi_1',
      object: 'payment_intent',
      metadata: {},
    });
    provider.verifyEvent(body, { 'stripe-signature': signPayload(body, secret, NOW.getTime()) });
    expect(script.requests).toHaveLength(0);
  });
});
