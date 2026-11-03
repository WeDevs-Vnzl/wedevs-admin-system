import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { APP_CONFIG, WorkerConfigModule } from './config/config.module';
import type { WorkerConfig } from './config/env.schema';
import { JobsModule } from './modules/jobs/jobs.module';
import { JobsRuntime } from './modules/jobs/interface/jobs/jobs-runtime';
import { SharedInfrastructureModule } from './shared/infrastructure/shared-infrastructure.module';

/** Worker config (no Clerk variable, Redis required, DT-169/DT-191), shared infrastructure and the scheduled jobs. Only the worker imports `JobsModule` (DT-169). */
@Module({ imports: [WorkerConfigModule, SharedInfrastructureModule, JobsModule] })
export class WorkerModule {}

/** Creates the worker's application context, starts the schedules and closes on SIGTERM/SIGINT. */
export async function startWorker(): Promise<INestApplicationContext> {
  const context = await NestFactory.createApplicationContext(WorkerModule, {
    // A bad environment must reject with its message (names only), not abort the process.
    abortOnError: false,
  });
  try {
    const config = context.get<WorkerConfig>(APP_CONFIG);
    if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
    await context.get(JobsRuntime).start(config.REDIS_URL, {}, (error) => {
      if (config.SENTRY_DSN) Sentry.captureException(error);
    });
  } catch (error) {
    await context.close();
    throw error;
  }
  context.enableShutdownHooks();
  return context;
}
