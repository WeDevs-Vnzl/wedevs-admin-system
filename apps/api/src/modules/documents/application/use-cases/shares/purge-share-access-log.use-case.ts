import type { Actor } from '../../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import {
  parseDateOnly,
  todayInCaracas,
  type DateOnly,
} from '../../../../../shared/domain/business-date';
import { ForbiddenError } from '../../../../../shared/domain/domain-error';
import type { ShareAccessLogRetentionPort } from '../../ports/share-access-log-retention.port';

/** Retention of the access log (DT-74). */
export const SHARE_ACCESS_LOG_RETENTION_MONTHS = 24;
/** Rows deleted per unit of work, and units per run: a daily scan stays bounded (A9). */
export const PURGE_BATCH_SIZE = 1000;
export const PURGE_MAX_BATCHES = 100;

/** Step name; also the entity id of its `SYSTEM_JOB` entries (the runner relies on it, A4). */
const PURGE_SHARE_ACCESS_LOG_STEP = 'purge-share-access-log';

/** Venezuela has no daylight saving since 2016: the Caracas day starts at 04:00 UTC. */
const CARACAS_UTC_OFFSET = '-04:00';

export interface PurgeShareAccessLogResult {
  readonly deleted: number;
  readonly batches: number;
  /** Rows created strictly before this instant were eligible. */
  readonly cutoff: Date;
}

/** The calendar day `months` before `day`, clamped to the last day of a shorter month (Feb 29 → Feb 28). */
function subtractMonths(day: DateOnly, months: number): DateOnly {
  const date = parseDateOnly(day);
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const target = new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
  return target.toISOString().slice(0, 10);
}

/** The first instant of the Caracas day that is 24 months before today's Caracas day. */
export function accessLogCutoff(now: Date): Date {
  const day = subtractMonths(todayInCaracas(now), SHARE_ACCESS_LOG_RETENTION_MONTHS);
  return new Date(`${day}T00:00:00.000${CARACAS_UTC_OFFSET}`);
}

/**
 * Step `retention` of BE-5 (DT-74, A9): hard-deletes the `ShareAccessLog` rows created strictly before the start
 * of the Caracas day 24 months ago. `SYSTEM` only, no route (DT-130). Each batch has its own unit of work and
 * the adapter filters by the cutoff in the `DELETE` itself, so a row at exactly the cutoff, and every row of the
 * lockout window (15 minutes), is never touched. The run is bounded (`maxBatches`); what is left waits for the
 * next one. Each batch that deleted rows writes its own `SYSTEM_JOB` entry (that batch's count) in the same unit
 * of work as its deletes, so they commit or roll back together (C12); a rerun changes nothing and writes nothing.
 */
export class PurgeShareAccessLog {
  private readonly batchSize: number;
  private readonly maxBatches: number;

  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly retention: ShareAccessLogRetentionPort,
    private readonly activityLog: ActivityLogPort,
    private readonly clock: ClockPort,
    options: { readonly batchSize: number; readonly maxBatches: number } = {
      batchSize: PURGE_BATCH_SIZE,
      maxBatches: PURGE_MAX_BATCHES,
    },
  ) {
    this.batchSize = options.batchSize;
    this.maxBatches = options.maxBatches;
  }

  async execute(actor: Actor): Promise<PurgeShareAccessLogResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const cutoff = accessLogCutoff(this.clock.now());
    let deleted = 0;
    let batches = 0;
    while (batches < this.maxBatches) {
      const batch = batches + 1;
      const count = await this.uow.run(async () => {
        const removed = await this.retention.deleteCreatedBefore(cutoff, this.batchSize);
        if (removed > 0) {
          await this.activityLog.record({
            actor,
            action: 'SYSTEM_JOB',
            entityType: 'SETTING',
            entityId: PURGE_SHARE_ACCESS_LOG_STEP,
            entityLabel: PURGE_SHARE_ACCESS_LOG_STEP,
            metadata: { deleted: removed, batches: batch, cutoff: cutoff.toISOString() },
          });
        }
        return removed;
      });
      batches = batch;
      deleted += count;
      if (count < this.batchSize) break;
    }
    return { deleted, batches, cutoff };
  }
}
