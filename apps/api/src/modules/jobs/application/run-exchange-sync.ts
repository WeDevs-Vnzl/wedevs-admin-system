import { SYSTEM_ACTOR } from '../../../shared/application/actor';
import { JobRunner, stepOf, type JobRunResult, type SystemUseCase } from './job-runner';

export const EXCHANGE_SYNC = 'exchange-sync';
/** Name of the sync step; also the entity id of its summary entry. */
export const SYNC_EXCHANGE_ACCOUNT = 'sync-exchange-account';

export interface ExchangeSyncCounts {
  readonly balances: number;
  readonly deposits: number;
  readonly recorded: number;
  readonly duplicates: number;
}

/**
 * The daily Binance poll (DT-169, DT-184): one `SYSTEM` step that stores the wallet snapshot and records the
 * deposits. A failing exchange call fails the job so the queue retries it (A3); the step is idempotent. It is
 * scheduled only when Binance is configured.
 */
export class RunExchangeSync {
  constructor(
    private readonly runner: JobRunner,
    private readonly sync: SystemUseCase<ExchangeSyncCounts>,
  ) {}

  execute(): Promise<JobRunResult> {
    return this.runner.run(SYSTEM_ACTOR, EXCHANGE_SYNC, [
      stepOf(SYNC_EXCHANGE_ACCOUNT, this.sync, (r) => ({
        counts: {
          balances: r.balances,
          deposits: r.deposits,
          recorded: r.recorded,
          duplicates: r.duplicates,
        },
      })),
    ]);
  }
}
