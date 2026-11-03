import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { IntegrationMappingModule } from '../../../src/modules/settings/integration-mapping.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1/settings/integrations';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

describe('integration mapping (e2e): DT-183, DT-184', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let methodId: string;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [IntegrationMappingModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  afterAll(async () => {
    await admin.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_map_${role.toLowerCase()}`,
          email: `map-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      const user: CurrentUser = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(user);
    }
    for (const [id, type, active] of [
      ['acc_bank', 'BANCO_INTERNACIONAL', true],
      ['acc_wallet', 'WALLET_CRIPTO', true],
      ['acc_off', 'BANCO_INTERNACIONAL', false],
    ] as const) {
      await admin.account.create({
        data: {
          id,
          name: id,
          type,
          currency: 'USD',
          active,
          openingBalance: '0.00',
          openingDate: new Date('2026-01-01'),
        },
      });
    }
    methodId = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).id;
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const put = (payload: object, role: UserRole = 'OWNER') =>
    request(app.getHttpServer()).put(BASE).set('Authorization', as(role)).send(payload);
  const get = (role: UserRole = 'OWNER') =>
    request(app.getHttpServer()).get(BASE).set('Authorization', as(role));

  it('is empty until the Owner saves it, then returns what was saved', async () => {
    expect((await get()).body).toEqual({ stripe: null, binance: null });
    const body = {
      stripe: { accountId: 'acc_bank', paymentMethodId: methodId },
      binance: { accountId: 'acc_wallet' },
    };
    const saved = await put(body);
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(body);
    expect((await get()).body).toEqual(body);
    const log = await admin.activityLog.findMany({ where: { entityType: 'SETTING' } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'SETTINGS_CHANGE', actorType: 'USER' });
  });

  it.each([
    [
      'inactive account',
      { stripe: { accountId: 'acc_off', paymentMethodId: 'METHOD' } },
      'stripe.accountId',
    ],
    [
      'unknown account',
      { stripe: { accountId: 'nope', paymentMethodId: 'METHOD' } },
      'stripe.accountId',
    ],
    [
      'unknown method',
      { stripe: { accountId: 'acc_bank', paymentMethodId: 'nope' } },
      'stripe.paymentMethodId',
    ],
    [
      'Binance account that is not a wallet',
      { binance: { accountId: 'acc_bank' } },
      'binance.accountId',
    ],
  ])('refuses %s with VALIDATION and saves nothing (C14)', async (_name, payload, field) => {
    const text = JSON.stringify(payload).replace('METHOD', methodId);
    const res = await put(JSON.parse(text) as object);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(Object.keys(res.body.error.fieldErrors)).toContain(field);
    expect((await get()).body).toEqual({ stripe: null, binance: null });
  });

  it('clears an integration with null', async () => {
    await put({ binance: { accountId: 'acc_wallet' } });
    const res = await put({ binance: null });
    expect(res.body).toEqual({ stripe: null, binance: null });
  });

  it('answers 403 to Member and Viewer on both routes, and 401 without a token', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      expect((await get(role)).status).toBe(403);
      expect((await put({}, role)).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get(BASE)).status).toBe(401);
  });
});
