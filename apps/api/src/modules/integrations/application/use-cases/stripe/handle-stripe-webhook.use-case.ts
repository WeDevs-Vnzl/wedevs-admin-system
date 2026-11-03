import type { Actor } from '../../../../../shared/application/actor';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  ForbiddenError,
  IntegrityLockedError,
  NotFoundError,
  ValidationFailedError,
} from '../../../../../shared/domain';
import type { IntegrationEventOutcome } from '../../../domain/integration-event';
import type {
  IntegrationEventEntry,
  IntegrationEventStore,
} from '../../ports/integration-event-store.port';
import type { IntegrationMappingPort } from '../../ports/integration-mapping.port';
import type { InvoiceForLinkPort } from '../../ports/invoice-for-link.port';
import type { PaymentLinkRepository } from '../../ports/payment-link.repository.port';
import type {
  PaymentProviderPort,
  ProviderEvent,
  ProviderPayment,
  ProviderHeaders,
} from '../../ports/payment-provider.port';
import type { ProviderPaymentRecordingPort } from './provider-payment-recording.port';

/** What the webhook answers: the HTTP route returns it as `outcome`. */
export type StripeWebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'parked';

/** `reasonCode` of a parked event (DT-183, A11). */
export const STRIPE_PARK_REASONS = {
  refund: 'REFUND',
  noPayment: 'NO_PAYMENT',
  paymentNotFound: 'PAYMENT_NOT_FOUND',
  noMapping: 'NO_MAPPING',
  noClient: 'NO_CLIENT',
  linkNotFound: 'LINK_NOT_FOUND',
  invoiceNotFound: 'INVOICE_NOT_FOUND',
  currencyMismatch: 'CURRENCY_MISMATCH',
  invalidReference: 'INVALID_REFERENCE',
  currencyUnsupported: 'CURRENCY_UNSUPPORTED',
  paymentNotSucceeded: 'PAYMENT_NOT_SUCCEEDED',
} as const;
type ParkReason = (typeof STRIPE_PARK_REASONS)[keyof typeof STRIPE_PARK_REASONS];

/** i18n key the adapter throws for a payment intent that has not succeeded. */
export const PAYMENT_NOT_SUCCEEDED_KEY = 'integrations.stripe.paymentNotSucceeded';

export interface StripeWebhookInput {
  readonly rawBody: string | Uint8Array;
  readonly headers: ProviderHeaders;
}

/**
 * `HandleStripeWebhook` (DT-183, A11, DT-192). The signature is verified first and nothing is written when it
 * fails (`UnauthenticatedError`). Then, by the event kind: unknown types are stored `IGNORED`, refunds `PARKED`
 * (`REFUND`, never voided automatically), and a payment is resolved (the provider's payment, the link and
 * invoice from OUR database, the client from the invoice or `metadata.clientId`, the Stripe account and method
 * from the mapping) and handed to finance's `RecordProviderPayment`, which stores the event, writes the payment
 * and completes the link in one `Serializable` unit of work. An event that cannot be resolved is stored `PARKED`
 * with a reason code. A repeated event id answers `duplicate`; a second event about the same provider payment
 * does too (finance stores it and writes nothing). Only an unexpected failure escapes, so Stripe retries.
 */
export class HandleStripeWebhook {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly provider: PaymentProviderPort,
    private readonly events: IntegrationEventStore,
    private readonly mapping: IntegrationMappingPort,
    private readonly links: PaymentLinkRepository,
    private readonly invoices: InvoiceForLinkPort,
    private readonly recording: ProviderPaymentRecordingPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: Actor, input: StripeWebhookInput): Promise<StripeWebhookOutcome> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const event = this.provider.verifyEvent(input.rawBody, input.headers);
    if (await this.events.find('STRIPE', event.eventId)) return 'duplicate';

    if (event.kind === 'OTHER') return this.store(event, 'IGNORED', null);
    if (event.kind === 'REFUND') return this.store(event, 'PARKED', STRIPE_PARK_REASONS.refund);
    return this.receive(event);
  }

  private async receive(event: ProviderEvent): Promise<StripeWebhookOutcome> {
    const park = (reason: ParkReason) => this.store(event, 'PARKED', reason);
    if (!event.paymentId) return park(STRIPE_PARK_REASONS.noPayment);
    const target = (await this.mapping.load()).stripe;
    if (!target) return park(STRIPE_PARK_REASONS.noMapping);

    let payment: ProviderPayment | null;
    try {
      payment = await this.provider.retrievePayment(event.paymentId);
    } catch (error) {
      if (error instanceof NotFoundError) return park(STRIPE_PARK_REASONS.paymentNotFound);
      // The adapter refuses a currency we do not charge and a payment that has not succeeded: park, never retry.
      if (error instanceof ValidationFailedError) {
        return park(
          error.message === PAYMENT_NOT_SUCCEEDED_KEY
            ? STRIPE_PARK_REASONS.paymentNotSucceeded
            : STRIPE_PARK_REASONS.currencyUnsupported,
        );
      }
      throw error;
    }

    const metadata = { ...payment.metadata, ...event.metadata };
    let clientId: string | null = null;
    let invoiceId: string | null = null;
    let linkId: string | null = null;
    if (metadata.linkId) {
      const link = await this.links.findById(metadata.linkId);
      if (!link) return park(STRIPE_PARK_REASONS.linkNotFound);
      const invoice = await this.invoices.load(link.invoiceId).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      });
      if (!invoice) return park(STRIPE_PARK_REASONS.invoiceNotFound);
      if (invoice.currency !== payment.currency) {
        return park(STRIPE_PARK_REASONS.currencyMismatch);
      }
      clientId = invoice.clientId;
      invoiceId = invoice.id;
      linkId = link.id;
    } else if (metadata.clientId) {
      clientId = metadata.clientId;
    }
    if (!clientId) return park(STRIPE_PARK_REASONS.noClient);

    try {
      const result = await this.recording.record({
        provider: 'STRIPE',
        eventId: event.eventId,
        eventType: event.type,
        externalId: payment.id,
        clientId,
        invoiceId,
        linkId,
        amount: payment.amount,
        currency: payment.currency,
        fee: payment.fee,
        receivedAt: payment.paidAt,
        accountId: target.accountId,
        methodId: target.paymentMethodId,
      });
      switch (result.outcome) {
        case 'RECORDED':
          return 'processed';
        case 'PARKED':
          return 'parked';
        default:
          return 'duplicate';
      }
    } catch (error) {
      // Only a refusal of the references parks. A `ConflictError` (exhausted serialization retries, a changed
      // lock set) is transient: it escapes, nothing is stored and Stripe retries the same event.
      if (
        !(
          error instanceof ValidationFailedError ||
          error instanceof NotFoundError ||
          error instanceof IntegrityLockedError
        )
      ) {
        throw error;
      }
      // Finance refused the references (inactive account or method, vanished client, wrong currency). Its
      // unit of work rolled back, so the event is stored on its own as parked for the partner to review.
      return park(reasonOf(error));
    }
  }

  private async store(
    event: ProviderEvent,
    outcome: IntegrationEventOutcome,
    reasonCode: string | null,
  ): Promise<StripeWebhookOutcome> {
    const now = this.clock.now();
    const entry: IntegrationEventEntry = {
      provider: 'STRIPE',
      eventId: event.eventId,
      type: event.type,
      outcome,
      reasonCode,
      entityType: null,
      entityId: null,
      receivedAt: now,
      processedAt: outcome === 'PARKED' ? null : now,
    };
    const result = await this.uow.run(() => this.events.record(entry));
    if (result === 'DUPLICATE') return 'duplicate';
    return outcome === 'PARKED' ? 'parked' : 'ignored';
  }
}

function reasonOf(error: Error): ParkReason {
  if (
    error instanceof ValidationFailedError &&
    error.fieldErrors &&
    'currency' in error.fieldErrors
  ) {
    return STRIPE_PARK_REASONS.currencyMismatch;
  }
  return STRIPE_PARK_REASONS.invalidReference;
}
