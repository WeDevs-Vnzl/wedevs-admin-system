import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  IntegrationEventEntry,
  IntegrationEventStore,
  RecordEventResult,
} from '../application/ports/integration-event-store.port';
import type { IntegrationProvider } from '../domain/integration-event';

/**
 * `IntegrationEvent` rows through the current transaction (or the base client outside a unit of work). The
 * insert is `ON CONFLICT DO NOTHING` on `(provider, eventId)`: a repeated delivery inserts zero rows, so it
 * answers `DUPLICATE` without raising inside the caller's transaction (A2, DT-192). No payload is stored.
 */
@Injectable()
export class PrismaIntegrationEventStore implements IntegrationEventStore {
  constructor(private readonly host: TransactionHost) {}

  async record(entry: IntegrationEventEntry): Promise<RecordEventResult> {
    const { count } = await this.host.db.integrationEvent.createMany({
      data: [
        {
          provider: entry.provider,
          eventId: entry.eventId,
          type: entry.type,
          outcome: entry.outcome,
          reasonCode: entry.reasonCode,
          entityType: entry.entityType,
          entityId: entry.entityId,
          receivedAt: entry.receivedAt,
          processedAt: entry.processedAt,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1 ? 'RECORDED' : 'DUPLICATE';
  }

  async find(
    provider: IntegrationProvider,
    eventId: string,
  ): Promise<IntegrationEventEntry | null> {
    const row = await this.host.db.integrationEvent.findUnique({
      where: { provider_eventId: { provider, eventId } },
    });
    if (!row) return null;
    return {
      provider: row.provider,
      eventId: row.eventId,
      type: row.type,
      outcome: row.outcome,
      reasonCode: row.reasonCode,
      entityType: row.entityType,
      entityId: row.entityId,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
    };
  }
}
