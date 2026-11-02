import Stripe from 'stripe';
import { UnauthenticatedError, ValidationFailedError } from '../../../../shared/domain';
import type {
  CreatePaymentLinkInput,
  CreatedPaymentLink,
  PaymentProviderPort,
  ProviderEvent,
  ProviderHeaders,
  ProviderPayment,
} from '../../application/ports/payment-provider.port';
import { decimalToMinor, minorToDecimal } from '../../domain/minor-units';
import { isStripeSignatureError, mapStripeError } from './stripe-errors';
import { toProviderEvent } from './stripe-event-mapper';

const SIGNATURE_HEADER = 'stripe-signature';
/** Currencies WeDevs charges through Stripe (DT-197); both have two fraction digits. */
const DECIMALS: Readonly<Record<string, number>> = { USD: 2, EUR: 2 };

function decimalsOf(currency: string): number {
  const decimals = DECIMALS[currency];
  if (decimals === undefined) {
    throw new ValidationFailedError({ message: 'validation.paymentLinkCurrencyUnsupported' });
  }
  return decimals;
}

/** Decimal string to the integer the wire needs; exact digits, converted to a JS number only at the boundary. */
function toUnitAmount(amount: string, currency: string): number {
  const minor = decimalToMinor(amount, decimalsOf(currency));
  const wire = Number(minor);
  if (minor <= 0n || !Number.isSafeInteger(wire)) {
    throw new ValidationFailedError({ fieldErrors: { amount: ['validation.money.invalid'] } });
  }
  return wire;
}

export interface StripePaymentProviderOptions {
  readonly apiKey: string;
  readonly webhookSecret: string;
  /** Where Checkout sends the payer after paying. Required by Stripe for hosted sessions. */
  readonly returnUrl: string;
  /** Injected so tests (and a future proxy) own the transport; production passes the SDK's fetch client. */
  readonly httpClient?: Stripe.HttpClient;
  /** Time source for the signature tolerance (the SDK would read `Date.now()`). */
  readonly clock?: () => Date;
}

export function createStripePaymentProvider(
  options: StripePaymentProviderOptions,
): StripePaymentProvider {
  const client = new Stripe(options.apiKey, {
    // The adapter never retries: the job or the use case retries with the same idempotency key.
    maxNetworkRetries: 0,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
  return new StripePaymentProvider(client, options);
}

function headerValue(headers: ProviderHeaders, name: string): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export class StripePaymentProvider implements PaymentProviderPort {
  private readonly clock: () => Date;

  constructor(
    private readonly client: Stripe,
    private readonly options: StripePaymentProviderOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  verifyEvent(rawBody: string | Uint8Array, headers: ProviderHeaders): ProviderEvent {
    const signature = headerValue(headers, SIGNATURE_HEADER);
    if (signature === null) throw new UnauthenticatedError();
    try {
      // `constructEvent` checks the HMAC and the default 300 s tolerance before it parses the body.
      const event = this.client.webhooks.constructEvent(
        rawBody,
        signature,
        this.options.webhookSecret,
        undefined,
        undefined,
        this.clock().getTime(),
      );
      return toProviderEvent(event);
    } catch (error) {
      if (isStripeSignatureError(error)) throw new UnauthenticatedError();
      throw mapStripeError(error);
    }
  }

  async retrievePayment(paymentId: string): Promise<ProviderPayment> {
    try {
      const intent = await this.client.paymentIntents.retrieve(paymentId, {
        expand: ['latest_charge.balance_transaction'],
      });
      const currency = intent.currency.toUpperCase();
      const decimals = decimalsOf(currency);
      const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      const transaction =
        charge && typeof charge.balance_transaction === 'object'
          ? charge.balance_transaction
          : null;
      // A fee settled in another currency is not comparable to the payment: left null for the caller to resolve.
      const fee =
        transaction && transaction.currency.toUpperCase() === currency
          ? minorToDecimal(BigInt(transaction.fee), decimals)
          : null;
      const received = intent.status === 'succeeded' ? intent.amount_received : intent.amount;
      return {
        id: intent.id,
        amount: minorToDecimal(BigInt(received), decimals),
        currency,
        fee,
        paidAt: new Date((charge?.created ?? intent.created) * 1000),
        metadata: { ...intent.metadata },
      };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  /**
   * A Checkout Session, not a Payment Link: a session takes its price inline (no Product/Price objects to
   * create and clean up), copies `metadata` to `checkout.session.completed` and `payment_intent_data.metadata`
   * to the PaymentIntent, and every POST accepts an idempotency key. It expires on its own after Stripe's
   * default 24 h; `expires_at` is deliberately not sent, so a retry with the same key carries identical params.
   */
  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatedPaymentLink> {
    const currency = input.currency.toUpperCase();
    const unitAmount = toUnitAmount(input.amount, currency);
    try {
      const session = await this.client.checkout.sessions.create(
        {
          mode: 'payment',
          success_url: this.options.returnUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: unitAmount,
                product_data: { name: input.description },
              },
            },
          ],
          metadata: { ...input.metadata },
          payment_intent_data: { metadata: { ...input.metadata } },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      if (!session.url) throw new Error('checkout session without a url');
      return { externalId: session.id, url: session.url };
    } catch (error) {
      throw mapStripeError(error);
    }
  }

  async deactivatePaymentLink(externalId: string): Promise<void> {
    try {
      const session = await this.client.checkout.sessions.retrieve(externalId);
      if (session.status !== 'open') return;
      try {
        await this.client.checkout.sessions.expire(externalId);
      } catch (error) {
        // Expired or completed between the read and the expire: the goal state holds, so it is success.
        const again = await this.client.checkout.sessions.retrieve(externalId);
        if (again.status === 'open') throw error;
      }
    } catch (error) {
      throw mapStripeError(error);
    }
  }
}
