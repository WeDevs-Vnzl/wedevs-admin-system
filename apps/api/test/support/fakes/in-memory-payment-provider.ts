import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CreatePaymentLinkInput,
  CreatedPaymentLink,
  PaymentProviderPort,
  ProviderEvent,
  ProviderHeaders,
  ProviderPayment,
} from '../../../src/modules/integrations/application/ports/payment-provider.port';
import { decimalToMinor } from '../../../src/modules/integrations/domain/minor-units';
import { NotFoundError, UnauthenticatedError } from '../../../src/shared/domain';

/** Header the fake reads its signature from (the real adapter reads the provider's own). */
export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';
/** Test-only constant, not a secret: the fake signs and verifies with it. */
const FAKE_KEY = 'in-memory-payment-provider-test-key';

function sign(body: string): string {
  return createHmac('sha256', FAKE_KEY).update(body).digest('hex');
}

/** Fake `PaymentProviderPort`: HMAC-signed JSON events, scripted payments, idempotent links. */
export class InMemoryPaymentProvider implements PaymentProviderPort {
  readonly payments = new Map<string, ProviderPayment>();
  readonly links = new Map<
    string,
    CreatedPaymentLink & { active: boolean; request: CreatePaymentLinkInput }
  >();
  private readonly byKey = new Map<string, string>();
  private sequence = 0;
  /** Test helper: the next `retrievePayment` calls throw this. */
  failRetrieveWith: Error | null = null;

  /** Test helper: a body and headers the fake accepts for `event`. */
  signedEvent(event: ProviderEvent): { rawBody: string; headers: Record<string, string> } {
    const rawBody = JSON.stringify({ ...event, occurredAt: event.occurredAt.toISOString() });
    return { rawBody, headers: { [FAKE_SIGNATURE_HEADER]: sign(rawBody) } };
  }

  /** Test helper: a payment `retrievePayment` can find. */
  addPayment(payment: ProviderPayment): void {
    this.payments.set(payment.id, payment);
  }

  verifyEvent(rawBody: string | Uint8Array, headers: ProviderHeaders): ProviderEvent {
    const text = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
    const header = headers[FAKE_SIGNATURE_HEADER];
    const given = Array.isArray(header) ? header[0] : header;
    const expected = Buffer.from(sign(text));
    const actual = Buffer.from(typeof given === 'string' ? given : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthenticatedError();
    }
    const parsed = JSON.parse(text) as Omit<ProviderEvent, 'occurredAt'> & { occurredAt: string };
    return { ...parsed, occurredAt: new Date(parsed.occurredAt) };
  }

  async retrievePayment(paymentId: string): Promise<ProviderPayment> {
    if (this.failRetrieveWith) throw this.failRetrieveWith;
    const payment = this.payments.get(paymentId);
    if (!payment) throw new NotFoundError();
    return payment;
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatedPaymentLink> {
    // The adapter converts to minor units; an amount finer than the currency is refused, never rounded.
    decimalToMinor(input.amount, 2);
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing !== undefined) {
      const link = this.links.get(existing);
      if (link) return { externalId: link.externalId, url: link.url };
    }
    this.sequence += 1;
    const externalId = `plink_fake_${this.sequence}`;
    const created = { externalId, url: `https://pay.example.test/${externalId}` };
    this.links.set(externalId, { ...created, active: true, request: input });
    this.byKey.set(input.idempotencyKey, externalId);
    return created;
  }

  async deactivatePaymentLink(externalId: string): Promise<void> {
    const link = this.links.get(externalId);
    if (!link) throw new NotFoundError();
    link.active = false;
  }
}
