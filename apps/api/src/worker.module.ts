import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { APP_CONFIG, AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';
import { JobsModule } from './modules/jobs/jobs.module';
import { JobsRuntime } from './modules/jobs/interface/jobs/jobs-runtime';
import { SharedInfrastructureModule } from './shared/infrastructure/shared-infrastructure.module';

/** Config, shared infrastructure and the scheduled jobs. Only the worker imports `JobsModule` (DT-169). */
@Module({ imports: [AppConfigModule, SharedInfrastructureModule, JobsModule] })
export class WorkerModule {}

/** DT-169: the worker is the only process that connects to Redis. Names the variable, never a value. */
export function requireRedisUrl(url: string | undefined): string {
  if (url === undefined || url === '') throw new Error('REDIS_URL is required to start the worker');
  return url;
}

/** Creates the worker's application context, starts the schedules and closes on SIGTERM/SIGINT. */
export async function startWorker(): Promise<INestApplicationContext> {
  const context = await NestFactory.createApplicationContext(WorkerModule);
  try {
    const config = context.get<AppConfig>(APP_CONFIG);
    const redisUrl = requireRedisUrl(config.REDIS_URL);
    if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
    await context.get(JobsRuntime).start(redisUrl, {}, (error) => {
      if (config.SENTRY_DSN) Sentry.captureException(error);
    });
  } catch (error) {
    await context.close();
    throw error;
  }
  context.enableShutdownHooks();
  return context;
}
