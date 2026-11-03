import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';

export interface RecordedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: URLSearchParams;
}

export interface ScriptedReply {
  readonly status: number;
  readonly body: unknown;
}

export type Route = (request: RecordedRequest) => ScriptedReply | undefined;

/** Test-only secrets generated per run: no real key or signing secret ever sits in the repository (C5). */
export const testApiKey = (): string => `sk_test_${randomBytes(12).toString('hex')}`;
export const testWebhookSecret = (): string => `whsec_${randomBytes(16).toString('hex')}`;

export function stripeError(
  status: number,
  type: string,
  code: string | null = null,
  message = 'scripted failure',
): ScriptedReply {
  return { status, body: { error: { type, code, message } } };
}

/**
 * A scripted `fetch` for the SDK's own fetch HTTP client: no socket is ever opened. A request no route answers
 * fails the test, so an unexpected call to a provider host cannot go unnoticed.
 */
export class ScriptedStripeFetch {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: Route[] = [];

  on(route: Route): this {
    this.routes.push(route);
    return this;
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const raw = typeof init?.body === 'string' ? init.body : '';
    const request: RecordedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      headers,
      body: new URLSearchParams(raw),
    };
    this.requests.push(request);
    for (const route of this.routes) {
      const reply = route(request);
      if (reply) {
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json', 'request-id': 'req_scripted' },
        });
      }
    }
    throw new Error(`unscripted Stripe request: ${request.method} ${url.pathname}`);
  };

  /** The SDK's own fetch-based client over this script (A7). */
  httpClient(): ReturnType<typeof Stripe.createFetchHttpClient> {
    return Stripe.createFetchHttpClient(this.fetch);
  }
}

/** Signs a payload as Stripe would, with the SDK's own test helper. */
export function signPayload(payload: string, secret: string, timestampMs = Date.now()): string {
  return new Stripe(testApiKey()).webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(timestampMs / 1000),
  });
}

/** A scripted Stripe API: idempotent session creation, payment intents, expiry. */
export function scriptedStripeApi(script: ScriptedStripeFetch): void {
  const sessions = new Map<string, { id: string; url: string; status: string }>();
  const byKey = new Map<string, string>();
  script
    .on((r) => {
      if (r.method === 'GET' && r.url.pathname === '/v1/payment_intents/pi_known') {
        return {
          status: 200,
          body: {
            id: 'pi_known',
            object: 'payment_intent',
            status: 'succeeded',
            amount: 12_550,
            amount_received: 12_550,
            currency: 'usd',
            metadata: { invoiceId: 'inv-1' },
            latest_charge: {
              id: 'ch_1',
              object: 'charge',
              created: 1_793_000_000,
              balance_transaction: {
                id: 'txn_1',
                object: 'balance_transaction',
                fee: 407,
                currency: 'usd',
              },
            },
          },
        };
      }
      if (r.method === 'GET' && r.url.pathname.startsWith('/v1/payment_intents/')) {
        return stripeError(404, 'invalid_request_error', 'resource_missing');
      }
      return undefined;
    })
    .on((r) => {
      if (r.method !== 'POST' || r.url.pathname !== '/v1/checkout/sessions') return undefined;
      const key = r.headers['idempotency-key'] ?? '';
      const known = byKey.get(key);
      if (known)
        return { status: 200, body: { object: 'checkout.session', ...sessions.get(known) } };
      const id = `cs_test_${sessions.size + 1}`;
      const session = { id, url: `https://checkout.example.test/c/pay/${id}`, status: 'open' };
      sessions.set(id, session);
      byKey.set(key, id);
      return { status: 200, body: { object: 'checkout.session', ...session } };
    })
    .on((r) => {
      const match = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(r.url.pathname);
      if (!match) return undefined;
      const session = sessions.get(match[1] ?? '');
      if (!session) return stripeError(404, 'invalid_request_error', 'resource_missing');
      if (match[2]) {
        if (session.status !== 'open')
          return stripeError(400, 'invalid_request_error', 'resource_invalid');
        session.status = 'expired';
      }
      return { status: 200, body: { object: 'checkout.session', ...session } };
    });
}
