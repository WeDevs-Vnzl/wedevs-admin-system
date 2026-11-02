import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG } from '../../../src/config/config.module';
import { parseEnv } from '../../../src/config/env.schema';
import { PortalModule } from '../../../src/modules/documents/portal.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import type { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import type { FixedClock } from '../../support/fakes/fixed-clock';
import type { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp, TEST_APP_URL } from '../../support/test-app';
import { TEST_ENV } from '../../support/test-env';

export interface PortalAppOptions {
  readonly authenticator: FakeAuthenticator;
  readonly storage: InMemoryFileStorage;
  readonly clock: FixedClock;
  /** Requests per `THROTTLE_TTL` seconds and IP; the default keeps a whole spec under the limit. */
  readonly throttleLimit?: number;
  readonly trustProxyHops?: number;
}

/**
 * The real Nest app with the portal module (and the share-link management module it builds on) over the
 * throwaway PostgreSQL, a fixed clock, in-memory file storage and the fake authenticator (the management
 * routes need it; the portal routes never read it, C24).
 */
export function createPortalApp(options: PortalAppOptions): Promise<NestExpressApplication> {
  const config = parseEnv({
    NODE_ENV: 'test',
    APP_URL: TEST_APP_URL,
    DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
    ...TEST_ENV,
    THROTTLE_TTL: '60',
    THROTTLE_LIMIT: String(options.throttleLimit ?? 100_000),
    TRUST_PROXY_HOPS: String(options.trustProxyHops ?? 0),
  });
  return createTestApp({
    modules: [PortalModule],
    authenticator: options.authenticator,
    overrides: [
      { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
      { token: FILE_STORAGE, useValue: options.storage },
      { token: CLOCK, useValue: options.clock },
      { token: APP_CONFIG, useValue: config },
    ],
  });
}
