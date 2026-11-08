import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FEATURES } from '../../src/config/config.module';
import type { FeaturesView } from '../../src/config/env.schema';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import { EXCHANGE } from '../../src/modules/integrations/application/ports/exchange.port';
import { INTEGRATION_EVENT_STORE } from '../../src/modules/integrations/application/ports/integration-event-store.port';
import { INTEGRATION_MAPPING } from '../../src/modules/integrations/application/ports/integration-mapping.port';
import { SyncExchangeAccount } from '../../src/modules/integrations/application/use-cases/exchange/sync-exchange-account.use-case';
import { SYSTEM_ACTOR } from '../../src/shared/application/actor';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import type { UserRole } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { InMemoryExchange } from '../support/fakes/in-memory-exchange';
import { InMemoryIntegrationEventStore } from '../support/fakes/in-memory-integration-event-store';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { createTestApp } from '../support/test-app';
import { DEPOSIT, StubMapping } from './exchange/world';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const SNAPSHOT_KEY = 'integrations.binance.snapshot';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

const FLAG_ENV = [
  'FEATURE_STRIPE',
  'FEATURE_BINANCE',
  'FEATURE_BANK_SYNC',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
] as const;

function clearFlagEnv(): void {
  for (const name of FLAG_ENV) Reflect.deleteProperty(process.env, name);
}

async function seedUsers(
  authenticator: FakeAuthenticator,
  prefix: string,
): Promise<Record<UserRole, string>> {
  const tokens = {} as Record<UserRole, string>;
  for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
    const row = await admin.user.create({
      data: {
        clerkId: `user_e2e_${prefix}_${role.toLowerCase()}`,
        email: `${prefix}-${role.toLowerCase()}@example.test`,
        name: role,
        role,
      },
    });
    tokens[role] = authenticator.issue({
      userId: row.id,
      clerkId: row.clerkId,
      role,
      email: row.email,
      name: row.name,
    });
  }
  return tokens;
}

afterAll(async () => {
  clearFlagEnv();
  await admin.setting.deleteMany({ where: { key: { in: [SNAPSHOT_KEY, 'integrations.mapping'] } } });
  await truncateBusinessTables(admin);
  await admin.$disconnect();
});

describe.each([
  ['the default env (every flag off)', {}, { stripe: false, binance: false, bankSync: false }],
  [
    'keys set, flags unset',
    {
      STRIPE_SECRET_KEY: 'sk_test_flags',
      STRIPE_WEBHOOK_SECRET: 'whsec_flags',
      BINANCE_API_KEY: 'k',
      BINANCE_API_SECRET: 'x',
    },
    { stripe: false, binance: false, bankSync: false },
  ],
  [
    'Binance on with its keys, bank sync on',
    {
      FEATURE_BINANCE: 'true',
      BINANCE_API_KEY: 'k',
      BINANCE_API_SECRET: 'x',
      FEATURE_BANK_SYNC: 'true',
    },
    { stripe: false, binance: true, bankSync: true },
  ],
] as const)('GET /features (e2e), %s: DT-227', (_label, env, expected) => {
  let app: NestExpressApplication;
  let tokens: Record<UserRole, string>;

  beforeAll(async () => {
    clearFlagEnv();
    Object.assign(process.env, env);
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
    await truncateBusinessTables(admin);
    tokens = await seedUsers(authenticator, 'features');
  });

  afterAll(async () => {
    clearFlagEnv();
    await app.close();
  });

  it('answers the effective flags to every role, booleans only', async () => {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/features`)
        .set('Authorization', `Bearer ${tokens[role]}`)
        .expect(200);
      expect(res.body).toEqual(expected);
    }
  });

  it('refuses an unauthenticated call with UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get(`${BASE}/features`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('Binance off (e2e): no stored snapshot is served, DT-227', () => {
  let app: NestExpressApplication;
  let tokens: Record<UserRole, string>;
  const mapping = new StubMapping({ stripe: null, binance: { accountId: 'pending' } });
  const features: { -readonly [K in keyof FeaturesView]: boolean } = {
    stripe: false,
    binance: true,
    bankSync: false,
  };

  beforeAll(async () => {
    clearFlagEnv();
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FEATURES, useValue: features },
        { token: INTEGRATION_MAPPING, useValue: mapping },
        { token: INTEGRATION_EVENT_STORE, useValue: new InMemoryIntegrationEventStore() },
        {
          token: EXCHANGE,
          useValue: new InMemoryExchange(
            [{ asset: 'USDT', free: '120.50', locked: '0.00' }],
            [DEPOSIT('dep_flags', new Date().toISOString())],
          ),
        },
      ],
    });
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: SNAPSHOT_KEY } });
    tokens = await seedUsers(authenticator, 'flags_snapshot');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the JSON null for the mapped wallet once the flag is off, even with a stored snapshot', async () => {
    const opened = await request(app.getHttpServer())
      .post(`${BASE}/accounts`)
      .set('Authorization', `Bearer ${tokens.OWNER}`)
      .send({
        name: 'Binance USDT',
        type: 'WALLET_CRIPTO',
        currency: 'USDT',
        openingBalance: '100.00',
        openingDate: '2026-01-01',
      })
      .expect(201);
    const id = opened.body.id as string;
    mapping.mapping = { stripe: null, binance: { accountId: id } };
    await app.get(SyncExchangeAccount).execute(SYSTEM_ACTOR);
    const get = () =>
      request(app.getHttpServer())
        .get(`${BASE}/accounts/${id}/exchange-snapshot`)
        .set('Authorization', `Bearer ${tokens.OWNER}`)
        .expect(200);

    expect((await get()).body.snapshot).not.toBeNull();
    features.binance = false;
    expect((await get()).text).toBe('null');
  });
});

describe('integration mapping behind the flags (e2e): DT-227', () => {
  let app: NestExpressApplication;
  let tokens: Record<UserRole, string>;
  let methodId: string;
  const features: { -readonly [K in keyof FeaturesView]: boolean } = {
    stripe: false,
    binance: false,
    bankSync: false,
  };

  beforeAll(async () => {
    clearFlagEnv();
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FEATURES, useValue: features },
      ],
    });
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    tokens = await seedUsers(authenticator, 'flags_mapping');
    for (const [id, type] of [
      ['acc_flags_bank', 'BANCO_INTERNACIONAL'],
      ['acc_flags_wallet', 'WALLET_CRIPTO'],
    ] as const) {
      await admin.account.create({
        data: {
          id,
          name: id,
          type,
          currency: 'USD',
          openingBalance: '0.00',
          openingDate: new Date('2026-01-01'),
        },
      });
    }
    methodId = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const put = (payload: object) =>
    request(app.getHttpServer())
      .put(`${BASE}/settings/integrations`)
      .set('Authorization', `Bearer ${tokens.OWNER}`)
      .send(payload);

  it('answers 404 NOT_FOUND on GET and PUT while Stripe and Binance are both off', async () => {
    features.stripe = false;
    features.binance = false;
    const read = await request(app.getHttpServer())
      .get(`${BASE}/settings/integrations`)
      .set('Authorization', `Bearer ${tokens.OWNER}`);
    const write = await put({ binance: { accountId: 'acc_flags_wallet' } });
    for (const res of [read, write]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect(await admin.setting.count({ where: { key: 'integrations.mapping' } })).toBe(0);
  });

  it('refuses a mapping for the off provider with VALIDATION and saves nothing', async () => {
    features.stripe = false;
    features.binance = true;
    const res = await put({
      stripe: { accountId: 'acc_flags_bank', paymentMethodId: methodId },
      binance: { accountId: 'acc_flags_wallet' },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(['stripe']);
    expect(await admin.setting.count({ where: { key: 'integrations.mapping' } })).toBe(0);
  });

  it('saves the mapping of the provider that is on', async () => {
    features.stripe = false;
    features.binance = true;
    const res = await put({ binance: { accountId: 'acc_flags_wallet' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stripe: null, binance: { accountId: 'acc_flags_wallet' } });
  });
});
