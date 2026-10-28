import type { ClientMetricsWriterPort } from '../../../src/shared/application/ports/client-metrics-writer.port';
import type { InMemoryUnitOfWork, TransactionParticipant } from './in-memory-unit-of-work';

export interface ClientMetricsRow {
  projectCount: number;
  lastActivityAt: Date | null;
  /** Stand-in for the money columns BE-3 owns; this writer must never change it. */
  receivableUsd: string;
}

const copy = (rows: Map<string, ClientMetricsRow>) =>
  new Map([...rows].map(([id, row]) => [id, { ...row }]));

/**
 * Fake `ClientMetricsWriterPort`. Like the adapter, an unknown client id is skipped by `touchActivity`
 * (`addClient` registers the clients that exist).
 */
export class InMemoryClientMetricsWriter
  implements ClientMetricsWriterPort, TransactionParticipant
{
  private committed = new Map<string, ClientMetricsRow>();
  private pending = new Map<string, ClientMetricsRow>();
  private readonly clients = new Set<string>();

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  addClient(clientId: string): void {
    this.clients.add(clientId);
  }

  /** Committed row, if any. */
  get(clientId: string): Readonly<ClientMetricsRow> | undefined {
    return this.committed.get(clientId);
  }

  /** Test setup: writes a money column directly, like BE-3's projector would. */
  seedReceivable(clientId: string, receivableUsd: string): void {
    const row = this.committed.get(clientId) ?? blank();
    this.committed.set(clientId, { ...row, receivableUsd });
  }

  private row(clientId: string): ClientMetricsRow {
    let row = this.pending.get(clientId);
    if (!row) {
      row = blank();
      this.pending.set(clientId, row);
    }
    return row;
  }

  async ensure(clientId: string): Promise<void> {
    this.uow.assertActive('ClientMetricsWriterPort.ensure');
    this.row(clientId);
  }

  async setProjectCount(clientId: string, count: number): Promise<void> {
    this.uow.assertActive('ClientMetricsWriterPort.setProjectCount');
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid projectCount: ${count}`);
    this.row(clientId).projectCount = count;
  }

  async touchActivity(clientIds: readonly string[], at: Date): Promise<void> {
    this.uow.assertActive('ClientMetricsWriterPort.touchActivity');
    for (const id of new Set(clientIds)) {
      if (!this.clients.has(id)) continue;
      const row = this.row(id);
      if (row.lastActivityAt === null || at > row.lastActivityAt) row.lastActivityAt = new Date(at);
    }
  }

  begin(): void {
    this.pending = copy(this.committed);
  }

  commit(): void {
    this.committed = this.pending;
  }

  rollback(): void {
    this.pending = copy(this.committed);
  }
}

function blank(): ClientMetricsRow {
  return { projectCount: 0, lastActivityAt: null, receivableUsd: '0.00' };
}
