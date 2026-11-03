import { describe, expect, it } from 'vitest';
import type {
  IntegrationEventEntry,
  IntegrationEventStore,
} from '../../../src/modules/integrations/application/ports/integration-event-store.port';

export interface IntegrationEventStoreHarness {
  readonly store: IntegrationEventStore;
}

const entry = (overrides: Partial<IntegrationEventEntry> = {}): IntegrationEventEntry => ({
  provider: 'STRIPE',
  eventId: 'evt_1',
  type: 'payment_intent.succeeded',
  outcome: 'PROCESSED',
  reasonCode: null,
  entityType: 'PAYMENT',
  entityId: 'pay-1',
  receivedAt: new Date('2026-11-02T10:00:00Z'),
  processedAt: new Date('2026-11-02T10:00:01Z'),
  ...overrides,
});

/** Contract of `IntegrationEventStore` (A2, DT-192): unique on `(provider, eventId)`. */
export function integrationEventStoreContract(
  name: string,
  factory: () => Promise<IntegrationEventStoreHarness> | IntegrationEventStoreHarness,
): void {
  describe(`IntegrationEventStore contract: ${name}`, () => {
    it('records a new event and finds it', async () => {
      const { store } = await factory();
      expect(await store.record(entry())).toBe('RECORDED');
      expect(await store.find('STRIPE', 'evt_1')).toEqual(entry());
    });

    it('answers DUPLICATE for the same provider and event id and keeps the first row', async () => {
      const { store } = await factory();
      await store.record(entry());
      expect(await store.record(entry({ outcome: 'IGNORED', entityId: null }))).toBe('DUPLICATE');
      expect((await store.find('STRIPE', 'evt_1'))?.outcome).toBe('PROCESSED');
    });

    it('treats the same event id of another provider as a different event', async () => {
      const { store } = await factory();
      await store.record(entry());
      expect(await store.record(entry({ provider: 'BINANCE' }))).toBe('RECORDED');
    });

    it('stores a parked event that has no entity', async () => {
      const { store } = await factory();
      const parked = entry({
        eventId: 'evt_parked',
        outcome: 'PARKED',
        reasonCode: 'NO_CLIENT',
        entityType: null,
        entityId: null,
        processedAt: null,
      });
      expect(await store.record(parked)).toBe('RECORDED');
      expect(await store.find('STRIPE', 'evt_parked')).toEqual(parked);
    });

    it('returns null for an unknown event', async () => {
      const { store } = await factory();
      expect(await store.find('STRIPE', 'missing')).toBeNull();
    });
  });
}
