import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { DailyMaintenance } from '../../src/modules/jobs/application/daily-maintenance';
import { RunCleanupFiles } from '../../src/modules/jobs/application/run-cleanup-files';
import { RunRetention } from '../../src/modules/jobs/application/run-retention';
import { FILE_STORAGE } from '../../src/modules/platform/application/ports/file-storage.port';
import { CLOCK } from '../../src/shared/application/ports/tokens';
import { WorkerModule } from '../../src/worker.module';
import { RecomputeAll } from '../../src/modules/finance/application/recompute-all';
import { InMemoryFileStorage } from '../support/fakes/in-memory-file-storage';
import { FixedClock } from '../support/fakes/fixed-clock';
import { applyTestEnv } from '../support/test-env';

/** Caracas business day 2026-10-29 (15:00 UTC is 11:00 in Caracas). */
export const DAY = '2026-10-29T15:00:00.000Z';

export interface JobsWorld {
  readonly context: INestApplicationContext;
  readonly clock: FixedClock;
  readonly storage: InMemoryFileStorage;
  readonly daily: DailyMaintenance;
  readonly retention: RunRetention;
  readonly cleanup: RunCleanupFiles;
  readonly recomputeAll: RecomputeAll;
  close(): Promise<void>;
}

/**
 * The real `WorkerModule` graph over the spec's database: only the clock and the file storage are replaced.
 * Redis is not involved (the runtime starts only in `startWorker`), so the job logic is triggered directly.
 */
export async function bootJobsWorld(at: string = DAY): Promise<JobsWorld> {
  applyTestEnv();
  Object.assign(process.env, { NODE_ENV: 'test', APP_URL: 'http://localhost:3001' });
  const clock = new FixedClock(at);
  const storage = new InMemoryFileStorage();
  const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(FILE_STORAGE)
    .useValue(storage)
    .compile();
  const context = await moduleRef.init();
  return {
    context,
    clock,
    storage,
    daily: context.get(DailyMaintenance),
    retention: context.get(RunRetention),
    cleanup: context.get(RunCleanupFiles),
    recomputeAll: context.get(RecomputeAll, { strict: false }),
    close: () => context.close(),
  };
}

export const SYSTEM_JOB_SUMMARIES = (admin: {
  activityLog: { count(args: object): Promise<number> };
}) => admin.activityLog.count({ where: { action: 'SYSTEM_JOB', entityType: 'SETTING' } });
