import type { JobsOptions, Queue } from 'bullmq';

export interface ScheduleDefinition {
  /** Both the scheduler id and the job name: the processor dispatches on it. */
  readonly name: string;
  /** Cron pattern, evaluated in UTC. */
  readonly pattern: string;
}

/** A5: the PRD's 10:00 UTC `daily-maintenance`, then retention and file cleanup, staggered. */
export const SCHEDULES: readonly ScheduleDefinition[] = [
  { name: 'daily-maintenance', pattern: '0 10 * * *' },
  { name: 'retention', pattern: '30 10 * * *' },
  { name: 'cleanup-files', pattern: '45 10 * * *' },
];

/**
 * DT-184: the Binance poll, once a day after the maintenance jobs. Not part of `SCHEDULES`: it is registered
 * only when Binance is configured (`schedulesFor`).
 */
export const EXCHANGE_SYNC_SCHEDULE: ScheduleDefinition = {
  name: 'exchange-sync',
  pattern: '0 11 * * *',
};

/** The schedules the worker registers; `registerSchedules` removes any scheduler left out (DT-152). */
export function schedulesFor(options: { readonly exchangeSync: boolean }): ScheduleDefinition[] {
  return options.exchangeSync ? [...SCHEDULES, EXCHANGE_SYNC_SCHEDULE] : [...SCHEDULES];
}

export interface RetryPolicy {
  readonly attempts: number;
  readonly backoffDelayMs: number;
}

/** A3: three attempts with exponential backoff. */
export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, backoffDelayMs: 60_000 };

/** Bounded history so Redis never grows without limit. */
export const HISTORY = { removeOnComplete: { count: 30 }, removeOnFail: { count: 100 } } as const;

export function jobOptions(retry: RetryPolicy): JobsOptions {
  return {
    attempts: retry.attempts,
    backoff: { type: 'exponential', delay: retry.backoffDelayMs },
    ...HISTORY,
  };
}

/**
 * Registers every listed scheduler (an upsert, so booting twice leaves one per job) and removes any scheduler
 * no longer listed (DT-152).
 */
export async function registerSchedules(
  queue: Queue,
  schedules: readonly ScheduleDefinition[] = SCHEDULES,
  retry: RetryPolicy = DEFAULT_RETRY,
): Promise<void> {
  for (const schedule of schedules) {
    await queue.upsertJobScheduler(
      schedule.name,
      { pattern: schedule.pattern, tz: 'UTC' },
      { name: schedule.name, data: {}, opts: jobOptions(retry) },
    );
  }
  const listed = new Set(schedules.map((schedule) => schedule.name));
  for (const existing of await queue.getJobSchedulers()) {
    const id = existing.key;
    if (!listed.has(id)) await queue.removeJobScheduler(id);
  }
}
