import type {
  IntegrationEventEntry,
  IntegrationEventStore,
  RecordEventResult,
} from '../../../src/modules/integrations/application/ports/integration-event-store.port';
import type { IntegrationProvider } from '../../../src/modules/integrations/domain/integration-event';

/** Fake `IntegrationEventStore`: unique on `(provider, eventId)`. */
export class InMemoryIntegrationEventStore implements IntegrationEventStore {
  private readonly rows = new Map<string, IntegrationEventEntry>();

  async record(entry: IntegrationEventEntry): Promise<RecordEventResult> {
    const key = `${entry.provider}:${entry.eventId}`;
    if (this.rows.has(key)) return 'DUPLICATE';
    this.rows.set(key, entry);
    return 'RECORDED';
  }

  async find(
    provider: IntegrationProvider,
    eventId: string,
  ): Promise<IntegrationEventEntry | null> {
    return this.rows.get(`${provider}:${eventId}`) ?? null;
  }

  all(): IntegrationEventEntry[] {
    return [...this.rows.values()];
  }
}
