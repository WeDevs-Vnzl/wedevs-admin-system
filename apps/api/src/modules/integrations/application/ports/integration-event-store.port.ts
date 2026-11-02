import type { EntityType } from '../../../../shared/domain';
import type { IntegrationEventOutcome, IntegrationProvider } from '../../domain/integration-event';

export const INTEGRATION_EVENT_STORE = Symbol('INTEGRATION_EVENT_STORE');

/** One row per provider event, unique on `(provider, eventId)` (A2). No payload is stored. */
export interface IntegrationEventEntry {
  readonly provider: IntegrationProvider;
  readonly eventId: string;
  readonly type: string;
  readonly outcome: IntegrationEventOutcome;
  readonly reasonCode: string | null;
  readonly entityType: EntityType | null;
  readonly entityId: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export type RecordEventResult = 'RECORDED' | 'DUPLICATE';

/** Idempotency key of every provider event (DT-192). */
export interface IntegrationEventStore {
  /**
   * Inserts the entry. `DUPLICATE` when `(provider, eventId)` exists: nothing is written and the caller
   * answers `duplicate`. Runs inside the caller's unit of work, as the first write of the event's effect.
   */
  record(entry: IntegrationEventEntry): Promise<RecordEventResult>;
  find(provider: IntegrationProvider, eventId: string): Promise<IntegrationEventEntry | null>;
}
