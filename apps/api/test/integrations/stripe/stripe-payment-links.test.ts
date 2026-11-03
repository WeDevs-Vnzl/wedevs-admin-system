import { describe, expect, it, vi } from 'vitest';
import { createStripePaymentProvider } from '../../../src/modules/integrations/infrastructure/stripe/stripe-payment-provider';
import {
  DomainError,
  NotFoundError,
  RateLimitedError,
  ValidationFailedError,
} from '../../../src/shared/domain';
import {
  ScriptedStripeFetch,
  scriptedStripeApi,
  stripeError,
  testApiKey,
  testWebhookSecret,
} from './scripted-stripe';

function postRequest(script: ScriptedStripeFetch) {
  const request = script.requests.find((r) => r.method === 'POST');
  if (!request) throw new Error('no POST was sent');
  return request;
}

function build(script = new ScriptedStripeFetch()) {
  const provider = createStripePaymentProvider({
    apiKey: testApiKey(),
    webhookSecret: testWebhookSecret(),
    httpClient: script.httpClient(),
    returnUrl: 'https://app.example.test/pay/done',
  });
  return { script, provider };
}

const input = (amount: string, currency = 'USD') => ({
  idempotencyKey: 'invoice-link:lnk-1',
  amount,
  currency,
  description: 'Invoice INV-7',
  metadata: { invoiceId: 'inv-7', linkId: 'lnk-1' },
});

describe('StripePaymentProvider.createPaymentLink', () => {
  it('sends the idempotency header, minor units and the link metadata on session and payment intent', async () => {
    const { script, provider } = build();
    scriptedStripeApi(script);
    const created = await provider.createPaymentLink(input('125.50', 'EUR'));
    expect(created.url).toMatch(/^https:\/\//);
    const request = postRequest(script);
    expect(request.headers['idempotency-key']).toBe('invoice-link:lnk-1');
    expect(request.body.get('mode')).toBe('payment');
    expect(request.body.get('line_items[0][price_data][unit_amount]')).toBe('12550');
    expect(request.body.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(request.body.get('line_items[0][quantity]')).toBe('1');
    expect(request.body.get('metadata[invoiceId]')).toBe('inv-7');
    expect(request.body.get('metadata[linkId]')).toBe('lnk-1');
    expect(request.body.get('payment_intent_data[metadata][linkId]')).toBe('lnk-1');
    expect(request.body.get('success_url')).toBe('https://app.example.test/pay/done');
    // No expires_at: a retry with the same key must carry byte-identical params (Stripe rejects a drift).
    expect(request.body.has('expires_at')).toBe(false);
  });

  it('converts the largest amount without a JS float', async () => {
    const { script, provider } = build();
    scriptedStripeApi(script);
    await provider.createPaymentLink(input('99999999.99'));
    const body = postRequest(script).body;
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('9999999999');
  });

  it('refuses a currency Stripe does not carry here, before any request', async () => {
    const { script, provider } = build();
    await expect(provider.createPaymentLink(input('10.00', 'VES'))).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(script.requests).toHaveLength(0);
  });

  it.each([
    [400, ValidationFailedError],
    [409, ValidationFailedError],
    [429, RateLimitedError],
    [401, DomainError],
    [500, DomainError],
    [503, DomainError],
  ])('turns a scripted %s into a typed failure', async (status, type) => {
    const { script, provider } = build();
    script.on(() => stripeError(status, status === 429 ? 'rate_limit_error' : 'api_error'));
    const error = await provider.createPaymentLink(input('10.00')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(type);
    if (status >= 500 || status === 401) expect((error as DomainError).code).toBe('INTERNAL');
    expect(script.requests).toHaveLength(1);
  });

  it('turns a dropped connection into a typed failure without retrying', async () => {
    const script = new ScriptedStripeFetch();
    const { provider } = build(script);
    const error = await provider.createPaymentLink(input('10.00')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).message).toBe('integrations.stripe.unavailable');
    expect(script.requests).toHaveLength(1);
  });
});

describe('StripePaymentProvider.deactivatePaymentLink', () => {
  it('expires an open session once and treats an already expired one as success without a second expire', async () => {
    const { script, provider } = build();
    scriptedStripeApi(script);
    const { externalId } = await provider.createPaymentLink(input('10.00'));
    await provider.deactivatePaymentLink(externalId);
    await provider.deactivatePaymentLink(externalId);
    const expires = script.requests.filter((r) => r.url.pathname.endsWith('/expire'));
    expect(expires).toHaveLength(1);
  });

  it('is success when the session expired between the read and the expire', async () => {
    const { script, provider } = build();
    let reads = 0;
    script.on((r) => {
      if (r.method === 'GET')
        return {
          status: 200,
          body: {
            id: 'cs_x',
            object: 'checkout.session',
            status: reads++ === 0 ? 'open' : 'expired',
          },
        };
      return stripeError(400, 'invalid_request_error', 'resource_invalid');
    });
    await expect(provider.deactivatePaymentLink('cs_x')).resolves.toBeUndefined();
  });

  it('answers NotFound for an unknown session', async () => {
    const { script, provider } = build();
    scriptedStripeApi(script);
    await expect(provider.deactivatePaymentLink('cs_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('keeps a provider failure typed', async () => {
    const { script, provider } = build();
    script.on(() => stripeError(500, 'api_error'));
    await expect(provider.deactivatePaymentLink('cs_x')).rejects.toBeInstanceOf(DomainError);
  });
});

describe('StripePaymentProvider.retrievePayment', () => {
  it('uses amount_received and the balance transaction fee in the payment currency', async () => {
    const { script, provider } = build();
    scriptedStripeApi(script);
    const payment = await provider.retrievePayment('pi_known');
    expect(payment).toMatchObject({ amount: '125.50', fee: '4.07', currency: 'USD' });
    expect(script.requests[0]?.url.searchParams.getAll('expand[0]')).toEqual([
      'latest_charge.balance_transaction',
    ]);
  });

  it('leaves the fee null when the balance transaction settles in another currency', async () => {
    const { script, provider } = build();
    script.on(() => ({
      status: 200,
      body: {
        id: 'pi_x',
        object: 'payment_intent',
        status: 'succeeded',
        amount: 1000,
        amount_received: 1000,
        currency: 'usd',
        metadata: {},
        latest_charge: {
          id: 'ch',
          object: 'charge',
          created: 1_793_000_000,
          balance_transaction: { id: 't', object: 'balance_transaction', fee: 50, currency: 'eur' },
        },
      },
    }));
    expect((await provider.retrievePayment('pi_x')).fee).toBeNull();
  });

  it('refuses a payment intent that has not succeeded instead of recording its requested amount', async () => {
    const { script, provider } = build();
    script.on(() => ({
      status: 200,
      body: {
        id: 'pi_p',
        object: 'payment_intent',
        status: 'requires_payment_method',
        amount: 1000,
        amount_received: 0,
        currency: 'usd',
        metadata: {},
      },
    }));
    const error = await provider.retrievePayment('pi_p').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect((error as ValidationFailedError).message).toBe(
      'integrations.stripe.paymentNotSucceeded',
    );
  });

  it('refuses a currency other than USD or EUR with the currency key', async () => {
    const { script, provider } = build();
    script.on(() => ({
      status: 200,
      body: {
        id: 'pi_g',
        object: 'payment_intent',
        status: 'succeeded',
        amount: 1000,
        amount_received: 1000,
        currency: 'gbp',
        metadata: {},
      },
    }));
    const error = await provider.retrievePayment('pi_g').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationFailedError);
    expect((error as ValidationFailedError).message).toBe(
      'validation.paymentLinkCurrencyUnsupported',
    );
  });
});

describe('no socket', () => {
  it('opens no connection and never touches the global fetch through the whole adapter surface', async () => {
    const net = await import('node:net');
    const sockets = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('socket opened');
    });
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('global fetch used');
    });
    try {
      const { script, provider } = build();
      scriptedStripeApi(script);
      const { externalId } = await provider.createPaymentLink(input('10.00'));
      await provider.deactivatePaymentLink(externalId);
      await provider.retrievePayment('pi_known');
      expect(script.requests.length).toBeGreaterThan(0);
      expect(sockets).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      sockets.mockRestore();
      globalFetch.mockRestore();
    }
  });
});
