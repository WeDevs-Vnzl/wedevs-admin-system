import type { DynamicModule, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { parseEnv } from '../../src/config/env.schema';
import { AUTHENTICATOR, AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import { ProbeModule } from '../e2e-fixtures/probe.module';
import { FakeAuthenticator } from './fakes/fake-authenticator';
import { FakeAuthorization } from './fakes/fake-authorization';
import { assertLocalDatabaseUrl } from './local-db-guard';
import { applyTestEnv, TEST_ENV } from './test-env';

export const TEST_APP_URL = 'http://localhost:3001';

export interface TestAppOptions {
  /** Extra modules; one that provides `AUTHENTICATOR` / `AUTHORIZATION` replaces the fake of that token. */
  readonly modules?: readonly (Type<unknown> | DynamicModule)[];
  /** Provider overrides applied to the compiled module. */
  readonly overrides?: readonly { readonly token: unknown; readonly useValue: unknown }[];
  readonly authenticator?: FakeAuthenticator;
  readonly authorization?: FakeAuthorization;
  /** Mounts the test-only `ProbeModule` routes (default true); the route inventory turns them off. */
  readonly probes?: boolean;
}

function providesToken(module: Type<unknown> | DynamicModule, token: symbol): boolean {
  const target = 'module' in module ? module.module : module;
  const providers = [
    ...((Reflect.getMetadata('providers', target) as unknown[] | undefined) ?? []),
    ...('module' in module ? ((module.providers as unknown[] | undefined) ?? []) : []),
  ];
  return providers.some(
    (p) => typeof p === 'object' && p !== null && (p as { provide?: unknown }).provide === token,
  );
}

/**
 * Boots the real `AppModule` plus the test-only probe routes through the production `configureApp`, with
 * `rawBody`, the fake env, the `AuthGuard` registered globally by `AppModule` (`APP_GUARD`), and
 * `FakeAuthenticator`/`FakeAuthorization` overriding the identity bindings unless the caller's modules provide those tokens. Fetch them with `app.get(AUTHENTICATOR)`.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  applyTestEnv();
  const databaseUrl = assertLocalDatabaseUrl(process.env.DATABASE_URL);
  const config = {
    ...parseEnv({
      NODE_ENV: 'test',
      APP_URL: TEST_APP_URL,
      DATABASE_URL: databaseUrl,
      ...TEST_ENV,
    }),
  };
  process.env.NODE_ENV = config.NODE_ENV;
  process.env.APP_URL = config.APP_URL;

  const modules = options.modules ?? [];
  // `AppModule` already binds the real `AUTHENTICATOR` / `AUTHORIZATION` (IdentityModule); the fakes
  // replace them unless the caller asks for the real ones by listing `IdentityModule` in `modules`.
  const fakes: { token: symbol; useValue: unknown }[] = [];
  if (!modules.some((m) => providesToken(m, AUTHENTICATOR))) {
    fakes.push({
      token: AUTHENTICATOR,
      useValue: options.authenticator ?? new FakeAuthenticator(),
    });
  }
  if (!modules.some((m) => providesToken(m, AUTHORIZATION))) {
    fakes.push({
      token: AUTHORIZATION,
      useValue: options.authorization ?? new FakeAuthorization(),
    });
  }

  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.probes === false ? [] : [ProbeModule]), ...modules],
  });
  for (const { token, useValue } of [...fakes, ...(options.overrides ?? [])]) {
    builder = builder.overrideProvider(token).useValue(useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    rawBody: true,
  });
  configureApp(app, config);
  await app.init();
  return app;
}
