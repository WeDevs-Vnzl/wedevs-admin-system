import type { Actor } from '../../../shared/application/actor';
import type { ActivityLogPort } from '../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../shared/application/ports/unit-of-work.port';

/** What a step reports: plain counts for the run summary (A4). */
export interface StepOutcome {
  readonly counts: Readonly<Record<string, number>>;
  /**
   * True when the step's own use case already wrote its `SYSTEM_JOB` summary for this run (the purge writes
   * one when it deleted rows), so the runner does not add a second one for the same step.
   */
  readonly summarized?: boolean;
}

/** One unit of a scheduled job: a `SYSTEM` use case behind a name. */
export interface JobStep {
  readonly name: string;
  run(actor: Actor): Promise<StepOutcome>;
}

export interface StepReport {
  readonly name: string;
  readonly status: 'ok' | 'failed';
  readonly counts: Readonly<Record<string, number>>;
}

export interface JobRunResult {
  readonly job: string;
  readonly steps: readonly StepReport[];
}

/** Logging surface of the runner; the module binds it to the application logger. */
export interface JobFailureLogger {
  stepFailed(context: {
    readonly job: string;
    readonly step: string;
    readonly error: unknown;
  }): void;
}

/** The job finished its remaining steps but at least one failed: the queue retries the whole job (A3). */
export class JobFailedError extends Error {
  constructor(
    readonly job: string,
    readonly failedSteps: readonly string[],
  ) {
    super(`Job ${job} failed at: ${failedSteps.join(', ')}`);
    this.name = 'JobFailedError';
  }
}

/**
 * Runs the steps of a job in order (A3, A4): a failing step is logged and does not stop the rest; once all
 * ran, the job fails so BullMQ retries it (every step is idempotent). Each step that completed leaves one
 * `SYSTEM_JOB` entry (entity `SETTING`, id = step name) with its counts, unless the step wrote its own.
 */
export class JobRunner {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly activityLog: ActivityLogPort,
    private readonly logger: JobFailureLogger,
  ) {}

  async run(actor: Actor, job: string, steps: readonly JobStep[]): Promise<JobRunResult> {
    const reports: StepReport[] = [];
    for (const step of steps) {
      try {
        const outcome = await step.run(actor);
        if (outcome.summarized !== true) await this.summarize(actor, job, step.name, outcome);
        reports.push({ name: step.name, status: 'ok', counts: outcome.counts });
      } catch (error) {
        this.logger.stepFailed({ job, step: step.name, error });
        reports.push({ name: step.name, status: 'failed', counts: {} });
      }
    }
    const failed = reports.filter((report) => report.status === 'failed').map((r) => r.name);
    if (failed.length > 0) throw new JobFailedError(job, failed);
    return { job, steps: reports };
  }

  private summarize(actor: Actor, job: string, step: string, outcome: StepOutcome): Promise<void> {
    return this.uow.run(() =>
      this.activityLog.record({
        actor,
        action: 'SYSTEM_JOB',
        entityType: 'SETTING',
        entityId: step,
        entityLabel: step,
        metadata: { job, ...outcome.counts },
      }),
    );
  }
}

/** A `SYSTEM` use case the jobs compose. */
export interface SystemUseCase<TResult> {
  execute(actor: Actor): Promise<TResult>;
}

/** Wraps a use case as a step, mapping its result to counts. */
export function stepOf<TResult>(
  name: string,
  useCase: SystemUseCase<TResult>,
  outcome: (result: TResult) => StepOutcome,
): JobStep {
  return { name, run: async (actor) => outcome(await useCase.execute(actor)) };
}
