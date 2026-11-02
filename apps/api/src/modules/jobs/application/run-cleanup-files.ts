import { SYSTEM_ACTOR } from '../../../shared/application/actor';
import { JobRunner, stepOf, type JobRunResult, type SystemUseCase } from './job-runner';

export const CLEANUP_FILES = 'cleanup-files';

export interface CleanupFilesCounts {
  readonly deleted: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * PRD §12 `cleanup-files` (DT-145). A file whose destroy failed stays for the next run and is already
 * reported by the use case, so the job does not fail on it.
 */
export class RunCleanupFiles {
  constructor(
    private readonly runner: JobRunner,
    private readonly cleanupFiles: SystemUseCase<CleanupFilesCounts>,
  ) {}

  execute(): Promise<JobRunResult> {
    return this.runner.run(SYSTEM_ACTOR, CLEANUP_FILES, [
      stepOf(CLEANUP_FILES, this.cleanupFiles, (r) => ({
        counts: { deleted: r.deleted, skipped: r.skipped, failed: r.failed },
      })),
    ]);
  }
}
