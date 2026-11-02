import { SYSTEM_ACTOR } from '../../../shared/application/actor';
import { JobRunner, stepOf, type JobRunResult, type SystemUseCase } from './job-runner';

export const RETENTION = 'retention';
/** Name of the purge step; also the entity id of its own summary entry. */
export const PURGE_SHARE_ACCESS_LOG = 'purge-share-access-log';

export interface PurgeCounts {
  readonly deleted: number;
  readonly batches: number;
}

/**
 * PRD §12 retention (DT-74): purges the `ShareAccessLog` older than 24 months. The purge writes its own
 * `SYSTEM_JOB` entries (same entity id as a runner summary), one per batch that deleted rows and in that batch's
 * unit of work, so the runner adds one only for a run that deleted nothing: never a duplicate summary (A4).
 */
export class RunRetention {
  constructor(
    private readonly runner: JobRunner,
    private readonly purge: SystemUseCase<PurgeCounts>,
  ) {}

  execute(): Promise<JobRunResult> {
    return this.runner.run(SYSTEM_ACTOR, RETENTION, [
      stepOf(PURGE_SHARE_ACCESS_LOG, this.purge, (r) => ({
        counts: { deleted: r.deleted, batches: r.batches },
        summarized: r.deleted > 0,
      })),
    ]);
  }
}
