import type Stripe from 'stripe';
import type { ProviderEvent } from '../../application/ports/payment-provider.port';

function metadataOf(value: Stripe.Metadata | null | undefined): Record<string, string> {
  return { ...(value ?? {}) };
}

function idOf(value: string | { readonly id: string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : value.id;
}

/**
 * Translates a signature-verified Stripe event to the port's model (DT-183). Only the three handled types carry
 * a payment; everything else is `OTHER` and the use case parks or ignores it. No SDK type is returned.
 */
export function toProviderEvent(event: Stripe.Event): ProviderEvent {
  const base = {
    eventId: event.id,
    type: event.type,
    occurredAt: new Date(event.created * 1000),
  };
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const intent = event.data.object;
      return {
        ...base,
        kind: 'PAYMENT_RECEIVED',
        paymentId: intent.id,
        metadata: metadataOf(intent.metadata),
      };
    }
    case 'checkout.session.completed': {
      const session = event.data.object;
      // An asynchronous method completes the session before the money arrives: that is not a payment yet.
      const paid = session.payment_status === 'paid';
      return {
        ...base,
        kind: paid ? 'PAYMENT_RECEIVED' : 'OTHER',
        paymentId: idOf(session.payment_intent),
        metadata: metadataOf(session.metadata),
      };
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      return {
        ...base,
        kind: 'REFUND',
        paymentId: idOf(charge.payment_intent),
        metadata: metadataOf(charge.metadata),
      };
    }
    default:
      return { ...base, kind: 'OTHER', paymentId: null, metadata: {} };
  }
}
