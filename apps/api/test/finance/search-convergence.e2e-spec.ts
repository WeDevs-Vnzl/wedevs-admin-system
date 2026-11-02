import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsModule } from '../../src/modules/finance/accounts.module';
import { MatrixAuthorization } from '../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { createTestApp } from '../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

describe('finance list search converges on SearchEntry (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  let authenticator: FakeAuthenticator;

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [AccountsModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    const row = await admin.user.create({
      data: {
        clerkId: 'user_e2e_search_convergence',
        email: 'search-convergence@example.test',
        name: 'Owner',
        role: 'OWNER',
      },
    });
    const user: CurrentUser = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: row.name,
    };
    token = authenticator.issue(user);
  });

  const http = () => request(app.getHttpServer());
  const post = (path: string, body: unknown) =>
    http()
      .post(`${BASE}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  const get = (path: string) =>
    http().get(`${BASE}${path}`).set('Authorization', `Bearer ${token}`);

  const accountBody = (over: Record<string, unknown> = {}) => ({
    name: 'Zelle USD',
    type: 'BILLETERA_DIGITAL',
    currency: 'USD',
    openingBalance: '1000.00',
    openingDate: '2026-01-01',
    ...over,
  });
  const names = (body: { items: { name: string }[] }) => body.items.map((item) => item.name);

  describe('accounts list q (DT-168)', () => {
    it('finds an account by the notes its SearchEntry holds', async () => {
      await post('/accounts', accountBody({ notes: 'cuenta de cobros habituales' })).expect(201);
      await post('/accounts', accountBody({ name: 'Otra cuenta' })).expect(201);

      const res = await get('/accounts?q=habituales').expect(200);

      expect(names(res.body)).toEqual(['Zelle USD']);
      expect(res.body.total).toBe(1);
    });

    it('keeps finding by name, institution, currency and holder (the columns it searched before)', async () => {
      await post(
        '/accounts',
        accountBody({ name: 'Banco principal', institution: 'Mercantil', holderName: 'Ana Pérez' }),
      ).expect(201);
      await post(
        '/accounts',
        accountBody({ name: 'Cripto', currency: 'USDT', type: 'WALLET_CRIPTO' }),
      ).expect(201);

      expect(names((await get('/accounts?q=mercantil').expect(200)).body)).toEqual([
        'Banco principal',
      ]);
      expect(names((await get('/accounts?q=PEREZ').expect(200)).body)).toEqual(['Banco principal']);
      expect(names((await get('/accounts?q=usdt').expect(200)).body)).toEqual(['Cripto']);
      expect(names((await get('/accounts?q=banco').expect(200)).body)).toEqual(['Banco principal']);
    });
  });
});
