import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APP_CONFIG, AppConfigModule } from './config/config.module';
import type { AppConfig } from './config/env.schema';

/** Shared and config only; the scheduled jobs (5.1) extend it. */
@Module({ imports: [AppConfigModule] })
export class WorkerModule {}

/** DT-169: the worker is the only process that connects to Redis. Names the variable, never a value. */
export function requireRedisUrl(url: string | undefined): string {
  if (url === undefined || url === '') throw new Error('REDIS_URL is required to start the worker');
  return url;
}

/** Creates the worker's application context, closing it on SIGTERM/SIGINT. */
export async function startWorker(): Promise<INestApplicationContext> {
  const context = await NestFactory.createApplicationContext(WorkerModule);
  try {
    requireRedisUrl(context.get<AppConfig>(APP_CONFIG).REDIS_URL);
  } catch (error) {
    await context.close();
    throw error;
  }
  context.enableShutdownHooks();
  return context;
}
