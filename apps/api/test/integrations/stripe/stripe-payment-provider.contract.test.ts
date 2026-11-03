import { paymentProviderContract } from '../contracts/payment-provider.contract';
import { createStripePaymentProvider } from '../../../src/modules/integrations/infrastructure/stripe/stripe-payment-provider';
import {
  ScriptedStripeFetch,
  scriptedStripeApi,
  signPayload,
  testApiKey,
  testWebhookSecret,
} from './scripted-stripe';

const NOW = new Date('2026-11-02T12:00:00.000Z');

paymentProviderContract('StripePaymentProvider (scripted HTTP)', () => {
  const script = new ScriptedStripeFetch();
  scriptedStripeApi(script);
  const secret = testWebhookSecret();
  const provider = createStripePaymentProvider({
    apiKey: testApiKey(),
    webhookSecret: secret,
    httpClient: script.httpClient(),
    returnUrl: 'https://app.example.test/pay/done',
    clock: () => NOW,
  });
  return {
    provider,
    validDelivery() {
      const rawBody = JSON.stringify({
        id: 'evt_contract',
        object: 'event',
        type: 'payment_intent.succeeded',
        created: Math.floor(NOW.getTime() / 1000),
        data: { object: { id: 'pi_known', object: 'payment_intent', metadata: {} } },
      });
      return {
        rawBody,
        headers: { 'stripe-signature': signPayload(rawBody, secret, NOW.getTime()) },
        expected: { eventId: 'evt_contract', kind: 'PAYMENT_RECEIVED', paymentId: 'pi_known' },
      };
    },
    tampered: (d) => ({ ...d, rawBody: d.rawBody.replace('pi_known', 'pi_other') }),
    knownPayment: {
      id: 'pi_known',
      amount: '125.50',
      currency: 'USD',
      fee: '4.07',
      paidAt: new Date(1_793_000_000 * 1000),
      metadata: { invoiceId: 'inv-1' },
    },
    unknownPaymentId: 'pi_unknown',
  };
});
