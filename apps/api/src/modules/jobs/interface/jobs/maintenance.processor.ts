import { Worker, type ConnectionOptions, type Job } from 'bullmq';

export const MAINTENANCE_QUEUE = 'maintenance';

/** The application classes the processor dispatches to, keyed by job name. */
export interface MaintenanceHandlers {
  readonly 'daily-maintenance': { execute(): Promise<unknown> };
  readonly retention: { execute(): Promise<unknown> };
  readonly 'cleanup-files': { execute(): Promise<unknown> };
}

export interface ProcessorOptions {
  readonly lockDuration?: number;
  readonly stalledInterval?: number;
  readonly onFailed?: (job: Job | undefined, error: Error) => void;
}

/** Dispatch by job name; an unknown name fails the job instead of being ignored. */
export function dispatch(handlers: MaintenanceHandlers, name: string): Promise<unknown> {
  if (!Object.hasOwn(handlers, name)) {
    return Promise.reject(new Error(`Unknown maintenance job: ${name}`));
  }
  return handlers[name as keyof MaintenanceHandlers].execute();
}

/**
 * The single worker of the queue: concurrency 1 (A3). The connection must have `maxRetriesPerRequest: null`
 * (BullMQ requirement for blocking commands).
 */
export function createMaintenanceWorker(
  connection: ConnectionOptions,
  handlers: MaintenanceHandlers,
  options: ProcessorOptions = {},
): Worker {
  const worker = new Worker(MAINTENANCE_QUEUE, async (job) => dispatch(handlers, job.name), {
    connection,
    concurrency: 1,
    ...(options.lockDuration === undefined ? {} : { lockDuration: options.lockDuration }),
    ...(options.stalledInterval === undefined ? {} : { stalledInterval: options.stalledInterval }),
  });
  worker.on('failed', (job, error) => options.onFailed?.(job, error));
  // A Redis error without a listener would crash the process; the connection retries on its own.
  worker.on('error', (error) => options.onFailed?.(undefined, error));
  return worker;
}
