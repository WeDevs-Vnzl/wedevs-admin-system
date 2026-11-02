import { HandleStripeWebhook } from '../../../src/modules/integrations/application/use-cases/stripe/handle-stripe-webhook.use-case';
import type {
  ProviderPaymentRecordingPort,
  RecordProviderPaymentCommand,
  RecordProviderPaymentOutcome,
} from '../../../src/modules/integrations/application/use-cases/stripe/provider-payment-recording.port';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import type { PaymentLink } from '../../../src/modules/integrations/domain/payment-link';
import type { ProviderEvent } from '../../../src/modules/integrations/application/ports/payment-provider.port';
import { DomainError, NotFoundError } from '../../../src/shared/domain';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryIntegrationEventStore } from '../../support/fakes/in-memory-integration-event-store';
import { InMemoryIntegrationMapping } from '../../support/fakes/in-memory-integration-mapping';
import { InMemoryInvoiceForPaymentLink } from '../../support/fakes/in-memory-invoice-for-payment-link';
import { InMemoryPaymentLinkRepository } from '../../support/fakes/in-memory-payment-link-repository';
import { InMemoryPaymentProvider } from '../../support/fakes/in-memory-payment-provider';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';

/** Fake recording port: one payment per provider payment id, like finance's `RecordProviderPayment`. */
export class FakeRecording implements ProviderPaymentRecordingPort {
  constructor(private readonly events: InMemoryIntegrationEventStore) {}

  readonly calls: RecordProviderPaymentCommand[] = [];
  /** Event ids a concurrent delivery stored between the handler's check and finance's insert. */
  readonly racedEvents = new Set<string>();
  readonly seenPayments = new Map<string, string>();
  failWith: Error | null = null;
  parkWith: 'NO_RATE' | null = null;

  async record(command: RecordProviderPaymentCommand): Promise<RecordProviderPaymentOutcome> {
    this.calls.push(command);
    if (this.failWith) throw this.failWith;
    if (this.racedEvents.has(command.eventId)) return { outcome: 'DUPLICATE' };
    const existing = this.seenPayments.get(command.externalId);
    const paymentId = existing ?? `pay-${this.seenPayments.size + 1}`;
    const stored = await this.events.record({
      provider: command.provider,
      eventId: command.eventId,
      type: command.eventType,
      outcome: this.parkWith ? 'PARKED' : 'PROCESSED',
      reasonCode: this.parkWith,
      entityType: this.parkWith ? null : 'PAYMENT',
      entityId: this.parkWith ? null : paymentId,
      receivedAt: command.receivedAt,
      processedAt: command.receivedAt,
    });
    if (stored === 'DUPLICATE') return { outcome: 'DUPLICATE' };
    if (this.parkWith) return { outcome: 'PARKED', reasonCode: this.parkWith };
    if (existing) return { outcome: 'EXISTING', paymentId: existing };
    this.seenPayments.set(command.externalId, paymentId);
    return { outcome: 'RECORDED', paymentId };
  }
}

export const linkOf = (over: Partial<PaymentLink> = {}): PaymentLink => ({
  id: 'lnk_1',
  invoiceId: 'inv_1',
  requestId: '11111111-1111-4111-8111-111111111111',
  provider: 'STRIPE',
  externalId: 'cs_1',
  url: 'https://pay.example.test/cs_1',
  amount: '60.00',
  currency: 'USD',
  status: 'ACTIVE',
  paymentId: null,
  deactivationReason: null,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  createdById: 'usr_1',
  deactivatedAt: null,
  settledAt: null,
  ...over,
});

export const eventOf = (over: Partial<ProviderEvent> = {}): ProviderEvent => ({
  eventId: 'evt_1',
  type: 'payment_intent.succeeded',
  kind: 'PAYMENT_RECEIVED',
  occurredAt: new Date('2026-11-02T11:00:00Z'),
  paymentId: 'pi_1',
  metadata: { invoiceId: 'inv_1', linkId: 'lnk_1' },
  ...over,
});

export function buildWorld() {
  const uow = new InMemoryUnitOfWork();
  const provider = new InMemoryPaymentProvider();
  const events = new InMemoryIntegrationEventStore();
  const mapping = new InMemoryIntegrationMapping({
    stripe: { accountId: 'acc_1', paymentMethodId: 'pm_1' },
  });
  const links = new InMemoryPaymentLinkRepository();
  const invoices = new InMemoryInvoiceForPaymentLink();
  const recording = new FakeRecording(events);
  const clock = new FixedClock('2026-11-02T12:00:00.000Z');
  invoices.add({
    id: 'inv_1',
    number: 'F-001',
    clientId: 'cli_1',
    currency: 'USD',
    openBalance: '100.00',
    open: true,
  });
  void links.save(linkOf());
  provider.addPayment({
    id: 'pi_1',
    amount: '60.00',
    currency: 'USD',
    fee: '2.04',
    paidAt: new Date('2026-11-02T10:59:00Z'),
    metadata: { invoiceId: 'inv_1', linkId: 'lnk_1' },
  });
  const handle = new HandleStripeWebhook(
    uow,
    provider,
    events,
    mapping,
    links,
    invoices,
    recording,
    clock,
  );
  /** Signs `event` with the fake provider and delivers it as the controller would. */
  const deliver = (event: ProviderEvent) => handle.execute(SYSTEM_ACTOR, signed(provider, event));
  return { uow, provider, events, mapping, links, invoices, recording, clock, handle, deliver };
}

export function signed(provider: InMemoryPaymentProvider, event: ProviderEvent) {
  const { rawBody, headers } = provider.signedEvent(event);
  return { rawBody, headers };
}

export const isDomainError = (error: unknown): error is DomainError => error instanceof DomainError;
export { NotFoundError };
