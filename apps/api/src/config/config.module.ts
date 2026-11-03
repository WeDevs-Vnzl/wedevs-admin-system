import { Global, Module } from '@nestjs/common';
import { type AppConfig, type WorkerConfig, parseEnv, parseWorkerEnv } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => parseEnv(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}

/** The worker's config under the same `APP_CONFIG` token, validated by `workerEnvSchema` (DT-191). */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): WorkerConfig => parseWorkerEnv(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class WorkerConfigModule {}
