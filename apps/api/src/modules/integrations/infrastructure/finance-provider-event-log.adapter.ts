import { Inject, Injectable } from '@nestjs/common';
import type {
  ProviderEventLogEntry,
  ProviderEventLogPort,
} from '../../finance/application/ports/provider-event-log.port';
import {
  INTEGRATION_EVENT_STORE,
  type IntegrationEventStore,
} from '../application/ports/integration-event-store.port';

/**
 * Finance's `ProviderEventLogPort` over `integrations`' event store (DT-110): one table, one idempotency key.
 * It runs in the ambient unit of work of the finance use case that calls it.
 */
@Injectable()
export class FinanceProviderEventLog implements ProviderEventLogPort {
  constructor(@Inject(INTEGRATION_EVENT_STORE) private readonly events: IntegrationEventStore) {}

  record(entry: ProviderEventLogEntry): Promise<'RECORDED' | 'DUPLICATE'> {
    return this.events.record(entry);
  }
}
