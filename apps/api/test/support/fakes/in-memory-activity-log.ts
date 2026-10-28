import type {
  ActivityEntry,
  ActivityLogPort,
} from '../../../src/shared/application/ports/activity-log.port';
import type { ClientMetricsWriterPort } from '../../../src/shared/application/ports/client-metrics-writer.port';
import type { RequestContextPort } from '../../../src/shared/application/ports/request-context.port';
import type { InMemoryUnitOfWork, TransactionParticipant } from './in-memory-unit-of-work';

export interface InMemoryActivityLogOptions {
  /** When set, `USER` entries without `ip`/`userAgent` get them from the current request. */
  readonly requestContext?: RequestContextPort;
  /** When set, an entry with a client bumps `lastActivityAt` through it. */
  readonly metrics?: ClientMetricsWriterPort;
  /** Instant of the bump (the adapter uses the row's `createdAt`). */
  readonly now?: () => Date;
}

/** Fake `ActivityLogPort`: buffers entries and publishes them on commit. Throws outside `run`. */
export class InMemoryActivityLog implements ActivityLogPort, TransactionParticipant {
  private committed: ActivityEntry[] = [];
  private pending: ActivityEntry[] = [];

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    private readonly options: InMemoryActivityLogOptions = {},
  ) {
    uow.enlist(this);
  }

  /** Committed entries only. */
  get entries(): readonly ActivityEntry[] {
    return this.committed;
  }

  async record(entry: ActivityEntry): Promise<void> {
    this.uow.assertActive('ActivityLogPort.record');
    const request =
      entry.actor.actorType === 'USER' ? this.options.requestContext?.current() : null;
    const stored: { -readonly [K in keyof ActivityEntry]: ActivityEntry[K] } = { ...entry };
    if (request) {
      stored.ip = entry.ip ?? request.ip;
      stored.userAgent = entry.userAgent ?? request.userAgent;
    }
    this.pending.push(stored);
    const touched = [...(entry.touchClientIds ?? []), ...(entry.clientId ? [entry.clientId] : [])];
    if (touched.length > 0 && this.options.metrics) {
      await this.options.metrics.touchActivity(touched, this.options.now?.() ?? new Date());
    }
  }

  begin(): void {
    this.pending = [];
  }

  commit(): void {
    this.committed = [...this.committed, ...this.pending];
    this.pending = [];
  }

  rollback(): void {
    this.pending = [];
  }
}
