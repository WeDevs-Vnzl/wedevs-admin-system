import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { EXCHANGE } from '../../../src/modules/integrations/application/ports/exchange.port';
import { INTEGRATION_EVENT_STORE } from '../../../src/modules/integrations/application/ports/integration-event-store.port';
import { INTEGRATION_MAPPING } from '../../../src/modules/integrations/application/ports/integration-mapping.port';
import { SyncExchangeAccount } from '../../../src/modules/integrations/application/use-cases/exchange/sync-exchange-account.use-case';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { InMemoryExchange } from '../../support/fakes/in-memory-exchange';
import { InMemoryIntegrationEventStore } from '../../support/fakes/in-memory-integration-event-store';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';
import { DEPOSIT, StubMapping } from './world';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

const mapping = new StubMapping({ stripe: null, binance: { accountId: 'pending' } });
const events = new InMemoryIntegrationEventStore();

describe('GET /accounts/{id}/exchange-snapshot (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: INTEGRATION_MAPPING, useValue: mapping },
        { token: INTEGRATION_EVENT_STORE, useValue: events },
        {
          token: EXCHANGE,
          useValue: new InMemoryExchange(
            [{ asset: 'USDT', free: '120.50', locked: '0.00' }],
            [DEPOSIT('dep_1', new Date().toISOString())],
          ),
        },
      ],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: 'integrations.binance.snapshot' } });
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: 'integrations.binance.snapshot' } });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_exchange_${role.toLowerCase()}`,
          email: `exchange-${role.toLowerCase()}@example.test`,
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
  });

  const get = (id: string, role: UserRole = 'OWNER') =>
    request(app.getHttpServer())
      .get(`${BASE}/accounts/${id}/exchange-snapshot`)
      .set('Authorization', `Bearer ${tokens[role]}`);

  const openWallet = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
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
    mapping.mapping = { stripe: null, binance: { accountId: res.body.id } };
    return res.body.id as string;
  };

  it('refuses an unauthenticated call with UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/accounts/acc_1/exchange-snapshot`)
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses Member and Viewer with FORBIDDEN', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const res = await get('acc_1', role).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('answers the JSON null when the account is not the mapped wallet', async () => {
    mapping.mapping = { stripe: null, binance: null };
    const res = await get('acc_other').expect(200);
    expect(res.text).toBe('null');
  });

  it('answers the stored snapshot beside the system balance, as strings', async () => {
    const id = await openWallet();
    await app.get(SyncExchangeAccount).execute(SYSTEM_ACTOR);

    const res = await get(id, 'ADMIN').expect(200);

    expect(res.body).toEqual({
      accountId: id,
      snapshot: {
        syncedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        balances: [{ asset: 'USDT', free: '120.50', locked: '0.00' }],
      },
      systemBalance: { currency: 'USDT', balance: '100.00', balanceUsd: null },
    });
    await expect(
      admin.setting.findUnique({ where: { key: 'integrations.binance.snapshot' } }),
    ).resolves.not.toBeNull();
    expect(events.all().map((e) => e.eventId)).toContain('dep_1');
  });

  it('answers a null snapshot for the mapped wallet before the first run', async () => {
    const id = await openWallet();
    const res = await get(id).expect(200);
    expect(res.body.snapshot).toBeNull();
    expect(res.body.systemBalance.balance).toBe('100.00');
  });
});
