import type { Actor } from '../../../../../shared/application/actor';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ForbiddenError } from '../../../../../shared/domain';
import type { ExchangeBalance, ExchangePort } from '../../ports/exchange.port';
import type { IntegrationEventStore } from '../../ports/integration-event-store.port';
import type { ExchangeSnapshotStore } from './exchange-snapshot.ports';

const DAY_MS = 86_400_000;
/** First run: how far back the deposit history is read. */
export const INITIAL_LOOKBACK_MS = 30 * DAY_MS;
/** Later runs re-read this much before the last run so a deposit credited late is not missed; events dedupe. */
export const OVERLAP_MS = 3 * DAY_MS;

export interface SyncExchangeResult {
  /** Balances kept in the snapshot (assets with something in the wallet). */
  readonly balances: number;
  /** Deposits the exchange returned for the window. */
  readonly deposits: number;
  /** Deposits seen for the first time (one `IntegrationEvent` each). */
  readonly recorded: number;
  readonly duplicates: number;
}

const hasFunds = (balance: ExchangeBalance): boolean => /[1-9]/.test(balance.free + balance.locked);

/**
 * `SyncExchangeAccount` (DT-184), `SYSTEM` only: reads the wallet balances and the deposits since the last
 * run, records one `IntegrationEvent` per deposit id (a rerun records none twice) and stores the snapshot, the
 * events and the snapshot in one unit of work. It writes no money and reads no rate (DT-185). An exchange
 * failure propagates before anything is written, so the job retries from the same point.
 */
export class SyncExchangeAccount {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly exchange: ExchangePort,
    private readonly events: IntegrationEventStore,
    private readonly store: ExchangeSnapshotStore,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: Actor): Promise<SyncExchangeResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const now = this.clock.now();
    const previous = await this.store.load();
    const since = previous
      ? new Date(previous.syncedAt.getTime() - OVERLAP_MS)
      : new Date(now.getTime() - INITIAL_LOOKBACK_MS);
    const balances = (await this.exchange.balances()).filter(hasFunds);
    const deposits = await this.exchange.deposits(since);

    return this.uow.run(async () => {
      let recorded = 0;
      for (const deposit of deposits) {
        const result = await this.events.record({
          provider: 'BINANCE',
          eventId: deposit.id,
          type: 'deposit',
          outcome: 'PROCESSED',
          reasonCode: null,
          entityType: null,
          entityId: null,
          receivedAt: now,
          processedAt: now,
        });
        if (result === 'RECORDED') recorded += 1;
      }
      await this.store.save({ syncedAt: now, balances });
      return {
        balances: balances.length,
        deposits: deposits.length,
        recorded,
        duplicates: deposits.length - recorded,
      };
    });
  }
}
