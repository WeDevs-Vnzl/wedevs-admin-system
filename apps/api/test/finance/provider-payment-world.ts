import type {
  IntegrationEventEntry,
  IntegrationEventStore,
  RecordEventResult,
} from '../../src/modules/integrations/application/ports/integration-event-store.port';
import type { SelectedRate } from '../../src/modules/finance/domain/rates';
import type { ExchangeRatePort } from '../../src/modules/finance/application/ports/exchange-rate.port';
import { RecordProviderPayment } from '../../src/modules/finance/application/use-cases/payments/record-provider-payment.use-case';
import type { RecordProviderPaymentCommand } from '../../src/modules/finance/application/use-cases/payments/record-provider-payment.use-case';
import { SYSTEM_ACTOR } from '../../src/shared/application/actor';
import { InMemoryPaymentLinkSettlement } from '../support/fakes/in-memory-payment-link-settlement';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../support/fakes/sequential-id-generator';
import { ACC_USD, ACC_VES, KAIROS, PM_ZELLE, createPaymentsWorld } from './payments/world';

export { ACC_USD, ACC_VES, KAIROS, PM_ZELLE };

/** `IntegrationEventStore` whose rows roll back with the unit of work, like the table. */
export class TransactionalEventStore implements IntegrationEventStore, TransactionParticipant {
  private rows = new Map<string, IntegrationEventEntry>();
  private snapshot: Map<string, IntegrationEventEntry> | null = null;

  constructor(uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  async record(entry: IntegrationEventEntry): Promise<RecordEventResult> {
    const key = `${entry.provider}:${entry.eventId}`;
    if (this.rows.has(key)) return 'DUPLICATE';
    this.rows.set(key, entry);
    return 'RECORDED';
  }

  async find(provider: string, eventId: string) {
    return this.rows.get(`${provider}:${eventId}`) ?? null;
  }

  get all(): IntegrationEventEntry[] {
    return [...this.rows.values()];
  }

  begin(): void {
    this.snapshot = new Map(this.rows);
  }
  commit(): void {
    this.snapshot = null;
  }
  rollback(): void {
    if (this.snapshot) this.rows = this.snapshot;
    this.snapshot = null;
  }
}

/** Rates by `currency:date`; USD is always 1 (the real source answers the same). */
export class FakeRates implements ExchangeRatePort {
  readonly byKey = new Map<string, SelectedRate>();

  set(currency: string, date: string, usdRate: string, isFallback = false): void {
    this.byKey.set(`${currency}:${date}`, {
      usdRate,
      source: 'MANUAL' as never,
      isFallback,
      effectiveDate: date,
      options: [],
    });
  }

  async getRateFor(date: string, currency: string): Promise<SelectedRate | null> {
    if (currency === 'USD') {
      return { usdRate: '1', source: null, isFallback: false, effectiveDate: date, options: [] };
    }
    return this.byKey.get(`${currency}:${date}`) ?? null;
  }
}

/** A Stripe-shaped command: 100.00 USD to the Zelle-like method of the world, no link. */
export const command = (over: Partial<RecordProviderPaymentCommand> = {}) =>
  ({
    provider: 'STRIPE',
    eventId: 'evt_1',
    eventType: 'payment_intent.succeeded',
    externalId: 'pi_1',
    clientId: KAIROS,
    invoiceId: null,
    linkId: null,
    amount: '100.00',
    currency: 'USD',
    fee: '3.20',
    receivedAt: new Date('2026-10-09T15:00:00.000Z'),
    accountId: ACC_USD,
    methodId: PM_ZELLE,
    ...over,
  }) as RecordProviderPaymentCommand;

/** The payments world plus the provider-payment use case over fakes that roll back with the unit of work. */
export function createProviderPaymentWorld() {
  const world = createPaymentsWorld();
  const events = new TransactionalEventStore(world.uow);
  const settlement = new InMemoryPaymentLinkSettlement(world.uow);
  const rates = new FakeRates();
  const record = new RecordProviderPayment(
    world.uow,
    world.support,
    world.sequence,
    new SequentialIdGenerator('prv'),
    events,
    rates,
    settlement,
    settlement,
  );
  return { ...world, events, settlement, rates, record, system: SYSTEM_ACTOR };
}

export type ProviderPaymentWorld = ReturnType<typeof createProviderPaymentWorld>;
