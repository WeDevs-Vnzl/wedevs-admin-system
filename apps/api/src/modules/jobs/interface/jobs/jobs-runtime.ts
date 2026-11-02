import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, type Worker } from 'bullmq';
import IORedis from 'ioredis';
import { APP_LOGGER, type AppLogger } from '../../../../shared/interface/logger';
import { DailyMaintenance } from '../../application/daily-maintenance';
import { RunCleanupFiles } from '../../application/run-cleanup-files';
import { RunRetention } from '../../application/run-retention';
import {
  createMaintenanceWorker,
  MAINTENANCE_QUEUE,
  type ProcessorOptions,
} from './maintenance.processor';
import {
  DEFAULT_RETRY,
  registerSchedules,
  SCHEDULES,
  type RetryPolicy,
  type ScheduleDefinition,
} from './schedules';

export interface JobsRuntimeOptions extends ProcessorOptions {
  readonly schedules?: readonly ScheduleDefinition[];
  readonly retry?: RetryPolicy;
}

/** Called for a failed attempt (Sentry in the worker bootstrap). */
export type JobFailureReporter = (error: unknown) => void;

/**
 * The worker's BullMQ side: one queue, its schedulers and its processor. Created only by the worker process
 * (DT-169) and closed with the application context.
 */
@Injectable()
export class JobsRuntime implements OnApplicationShutdown {
  private connections: IORedis[] = [];
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    private readonly dailyMaintenance: DailyMaintenance,
    private readonly retention: RunRetention,
    private readonly cleanupFiles: RunCleanupFiles,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** Connects, registers the schedulers and starts the processor. */
  async start(
    redisUrl: string,
    options: JobsRuntimeOptions = {},
    report?: JobFailureReporter,
  ): Promise<void> {
    const queueConnection = this.connect(redisUrl);
    const workerConnection = this.connect(redisUrl);
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: queueConnection });
    this.queue.on('error', (error) => this.logger.error({ err: error }, 'Jobs queue error'));
    await registerSchedules(
      this.queue,
      options.schedules ?? SCHEDULES,
      options.retry ?? DEFAULT_RETRY,
    );
    this.worker = createMaintenanceWorker(
      workerConnection,
      {
        'daily-maintenance': this.dailyMaintenance,
        retention: this.retention,
        'cleanup-files': this.cleanupFiles,
      },
      {
        ...options,
        onFailed: (job, error) => {
          this.logger.error(
            { job: job?.name, attempt: job?.attemptsMade, err: error },
            'Scheduled job attempt failed',
          );
          report?.(error);
          options.onFailed?.(job, error);
        },
      },
    );
    await this.worker.waitUntilReady();
  }

  async close(): Promise<void> {
    const worker = this.worker;
    const queue = this.queue;
    this.worker = null;
    this.queue = null;
    await worker?.close();
    await queue?.close();
    await Promise.all(this.connections.map((connection) => connection.quit().catch(() => 0)));
    this.connections = [];
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private connect(redisUrl: string): IORedis {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', (error) => this.logger.error({ err: error }, 'Redis connection error'));
    this.connections.push(connection);
    return connection;
  }
}
