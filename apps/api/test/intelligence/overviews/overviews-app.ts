import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/app.setup';
import { parseEnv } from '../../../src/config/env.schema';
import { OverviewsModule } from '../../../src/modules/intelligence/overviews.module';
import { AUTHENTICATOR, AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { ClockPort } from '../../../src/shared/application/ports/clock.port';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { applyTestEnv, TEST_ENV } from '../../support/test-env';

/**
 * The real `AppModule` with `OverviewsModule` imported **first**, so its `/x/overview` routes register
 * before the owners' `/x/:id` (A1, X13). `createTestApp` appends extra modules after `AppModule`, which
 * would let `:id` shadow them. Real permission matrix, test identity in place of Clerk.
 */
export async function createOverviewsApp(
  authenticator: FakeAuthenticator,
  clock: ClockPort,
): Promise<NestExpressApplication> {
  applyTestEnv();
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const config = {
    ...parseEnv({
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3001',
      DATABASE_URL: databaseUrl,
      ...TEST_ENV,
    }),
  };
  process.env.NODE_ENV = config.NODE_ENV;
  process.env.APP_URL = config.APP_URL;

  const moduleRef = await Test.createTestingModule({ imports: [OverviewsModule, AppModule] })
    .overrideProvider(AUTHENTICATOR)
    .useValue(authenticator)
    .overrideProvider(AUTHORIZATION)
    .useValue(new MatrixAuthorization())
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
  });
  configureApp(app, config);
  await app.init();
  return app;
}
