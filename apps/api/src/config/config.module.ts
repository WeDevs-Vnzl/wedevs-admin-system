import { Global, Module } from '@nestjs/common';
import {
  type AppConfig,
  type FeaturesView,
  type WorkerConfig,
  featuresOf,
  parseEnv,
  parseWorkerEnv,
} from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** The effective integration feature flags (`FeaturesView`, DT-227), in the API and in the worker. */
export const FEATURES = Symbol('FEATURES');

const featuresProvider = {
  provide: FEATURES,
  useFactory: (config: AppConfig | WorkerConfig): FeaturesView => featuresOf(config),
  inject: [APP_CONFIG],
};

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => parseEnv(process.env),
    },
    featuresProvider,
  ],
  exports: [APP_CONFIG, FEATURES],
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
    featuresProvider,
  ],
  exports: [APP_CONFIG, FEATURES],
})
export class WorkerConfigModule {}
