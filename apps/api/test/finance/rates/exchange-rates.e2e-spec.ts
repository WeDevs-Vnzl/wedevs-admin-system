import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RatesModule } from '../../../src/modules/finance/rates.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
const CLERK_PREFIX = 'user_e2e_rates_';

describe('exchange rates (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  const tokens: Partial<Record<UserRole, string>> = {};
  const userIds: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [RatesModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  afterAll(async () => {
    await clean();
    await app.close();
    await admin.$disconnect();
  });

  async function clean() {
    await admin.expense.deleteMany({ where: { description: { startsWith: 'e2e-rates' } } });
    await admin.activityLog.deleteMany({ where: { entityType: 'SETTING' } });
    await admin.exchangeRate.deleteMany();
    await admin.user.deleteMany({ where: { clerkId: { startsWith: CLERK_PREFIX } } });
  }

  beforeEach(async () => {
    await clean();
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `${CLERK_PREFIX}${role.toLowerCase()}`,
          email: `rates-${role.toLowerCase()}@example.test`,
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
      userIds[role] = row.id;
      tokens[role] = authenticator.issue(user);
    }
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());
  const rateBody = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-12',
    currency: 'VES',
    usdRate: '755.16',
    source: 'BCV',
    ...over,
  });

  describe('access', () => {
    it('answers UNAUTHENTICATED on every route without a session', async () => {
      for (const call of [
        () => http().get(`${BASE}/exchange-rates`),
        () => http().get(`${BASE}/exchange-rates/lookup?date=2026-10-12&currency=VES`),
        () => http().post(`${BASE}/exchange-rates`).send(rateBody()),
        () => http().post(`${BASE}/exchange-rates/daily`).send({}),
        () => http().post(`${BASE}/exchange-rates/import`).send({}),
      ]) {
        const res = await call().expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('gives Member and Viewer FORBIDDEN on list and every write, and writes nothing', async () => {
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        await http().get(`${BASE}/exchange-rates`).set('Authorization', as(role)).expect(403);
        for (const [path, body] of [
          ['', rateBody()],
          ['/daily', { date: '2026-10-12', rates: [{ currency: 'VES', usdRate: '5' }] }],
          ['/import', { rows: [rateBody()] }],
        ] as const) {
          const res = await http()
            .post(`${BASE}/exchange-rates${path}`)
            .set('Authorization', as(role))
            .send(body)
            .expect(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
      expect(await admin.exchangeRate.count()).toBe(0);
      expect(await admin.activityLog.count({ where: { action: 'SETTINGS_CHANGE' } })).toBe(0);
    });

    it('lets any signed-in role use the lookup, and Owner and Admin list', async () => {
      for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
        await http()
          .get(`${BASE}/exchange-rates/lookup?date=2026-10-12&currency=VES`)
          .set('Authorization', as(role))
          .expect(200);
      }
      for (const role of ['OWNER', 'ADMIN'] as const) {
        await http().get(`${BASE}/exchange-rates`).set('Authorization', as(role)).expect(200);
      }
    });
  });

  describe('upsert', () => {
    it('creates a rate, then updates the same key, and logs one SETTINGS_CHANGE each time', async () => {
      const first = await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody())
        .expect(200);
      expect(first.body).toMatchObject({
        created: true,
        deviationExceeded: false,
        rate: {
          date: '2026-10-12',
          currency: 'VES',
          usdRate: '755.16',
          source: 'BCV',
          createdById: userIds.OWNER,
        },
      });
      const second = await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('ADMIN'))
        .send(rateBody({ usdRate: '756' }))
        .expect(200);
      expect(second.body).toMatchObject({
        created: false,
        rate: { id: first.body.rate.id, usdRate: '756', createdById: userIds.OWNER },
      });
      expect(await admin.exchangeRate.count()).toBe(1);

      const logs = await admin.activityLog.findMany({ where: { action: 'SETTINGS_CHANGE' } });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({ entityType: 'SETTING', entityLabel: 'VES 2026-10-12' });
    });

    it('defaults the source to MANUAL and flags a deviation above 10 % from the latest rate', async () => {
      await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ date: '2026-10-09', usdRate: '100', source: undefined }))
        .expect(200)
        .expect((res) => expect(res.body.rate.source).toBe('MANUAL'));
      const res = await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ usdRate: '111', source: 'MANUAL' }))
        .expect(200);
      expect(res.body.deviationExceeded).toBe(true);
    });

    it('answers VALIDATION with field errors for an unknown currency, USD and a bad rate', async () => {
      const unknown = await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ currency: 'ABC' }))
        .expect(422);
      expect(unknown.body.error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { currency: ['catalogs.rates.errors.unknownCurrency'] },
      });
      const usd = await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ currency: 'USD' }))
        .expect(422);
      expect(usd.body.error.fieldErrors.currency).toEqual([
        'catalogs.validation.rateCurrencyIsUsd',
      ]);
      const bad = await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ usdRate: '0' }))
        .expect(422);
      expect(bad.body.error.fieldErrors.usdRate).toEqual(['validation.rate.mustBePositive']);
      expect(await admin.exchangeRate.count()).toBe(0);
    });

    it('never touches a snapshot taken from an earlier rate (C16)', async () => {
      const category = await admin.expenseCategory.findFirstOrThrow();
      const expense = await admin.expense.create({
        data: {
          code: 'e2e-rates-exp',
          date: new Date('2026-10-12T00:00:00.000Z'),
          description: 'e2e-rates snapshot',
          categoryId: category.id,
          currency: 'VES',
          amount: '7551.60',
          usdRate: '755.16',
          amountUsd: '10.00',
          status: 'PENDIENTE',
        },
      });
      await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ usdRate: '900' }))
        .expect(200);
      await http()
        .post(`${BASE}/exchange-rates/import`)
        .set('Authorization', as('OWNER'))
        .send({ rows: [rateBody({ usdRate: '950' })], overwrite: true })
        .expect(200);
      const after = await admin.expense.findUniqueOrThrow({ where: { id: expense.id } });
      expect(after.usdRate.toFixed()).toBe('755.16');
      expect(after.amountUsd.toFixed()).toBe('10');
      expect(after.updatedAt).toEqual(expense.updatedAt);
    });
  });

  describe('daily load and import', () => {
    it('loads several currencies at once and replays as updates', async () => {
      const body = {
        date: '2026-10-12',
        source: 'BCV',
        rates: [
          { currency: 'VES', usdRate: '757.5' },
          { currency: 'EUR', usdRate: '0.861' },
        ],
      };
      const first = await http()
        .post(`${BASE}/exchange-rates/daily`)
        .set('Authorization', as('OWNER'))
        .send(body)
        .expect(200);
      expect(first.body).toEqual({ created: 2, updated: 0 });
      const replay = await http()
        .post(`${BASE}/exchange-rates/daily`)
        .set('Authorization', as('ADMIN'))
        .send(body)
        .expect(200);
      expect(replay.body).toEqual({ created: 0, updated: 2 });
      expect(await admin.exchangeRate.count()).toBe(2);
    });

    it('refuses the whole daily batch for an unknown currency and a repeated one', async () => {
      const unknown = await http()
        .post(`${BASE}/exchange-rates/daily`)
        .set('Authorization', as('OWNER'))
        .send({
          date: '2026-10-12',
          rates: [
            { currency: 'VES', usdRate: '757.5' },
            { currency: 'ABC', usdRate: '3' },
          ],
        })
        .expect(422);
      expect(unknown.body.error.fieldErrors).toEqual({
        'rates.1.currency': ['catalogs.rates.errors.unknownCurrency'],
      });
      const repeated = await http()
        .post(`${BASE}/exchange-rates/daily`)
        .set('Authorization', as('OWNER'))
        .send({
          date: '2026-10-12',
          rates: [
            { currency: 'VES', usdRate: '1' },
            { currency: 'VES', usdRate: '2' },
          ],
        })
        .expect(422);
      expect(repeated.body.error.fieldErrors).toEqual({
        'rates.1.currency': ['catalogs.validation.duplicateRateCurrency'],
      });
      expect(await admin.exchangeRate.count()).toBe(0);
    });

    it('imports rows, skips existing keys unless overwrite, and reports unknown currencies by row', async () => {
      await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ usdRate: '700' }))
        .expect(200);
      const rows = [
        rateBody({ usdRate: '757.5' }),
        rateBody({ currency: 'EUR', usdRate: '0.86', source: 'MANUAL' }),
        rateBody({ currency: 'ABC', usdRate: '3' }),
      ];
      const first = await http()
        .post(`${BASE}/exchange-rates/import`)
        .set('Authorization', as('OWNER'))
        .send({ rows })
        .expect(200);
      expect(first.body).toEqual({
        created: 1,
        updated: 0,
        skipped: 1,
        errors: [{ row: 3, messages: ['catalogs.rates.errors.unknownCurrency'] }],
      });
      const second = await http()
        .post(`${BASE}/exchange-rates/import`)
        .set('Authorization', as('OWNER'))
        .send({ rows, overwrite: true })
        .expect(200);
      expect(second.body).toMatchObject({ created: 0, updated: 2, skipped: 0 });
      const ves = await admin.exchangeRate.findFirstOrThrow({ where: { currency: 'VES' } });
      expect(ves.usdRate.toFixed()).toBe('757.5');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await http()
        .post(`${BASE}/exchange-rates/daily`)
        .set('Authorization', as('OWNER'))
        .send({
          date: '2026-10-09',
          source: 'BCV',
          rates: [
            { currency: 'VES', usdRate: '755' },
            { currency: 'EUR', usdRate: '0.86' },
          ],
        })
        .expect(200);
      await http()
        .post(`${BASE}/exchange-rates`)
        .set('Authorization', as('OWNER'))
        .send(rateBody({ source: 'MANUAL', usdRate: '760' }))
        .expect(200);
    });

    it('returns the paginated envelope, newest date first, with decimal strings', async () => {
      const res = await http()
        .get(`${BASE}/exchange-rates`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
      expect(res.body.items[0]).toMatchObject({
        date: '2026-10-12',
        usdRate: '760',
        source: 'MANUAL',
      });
      expect(
        res.body.items.every((row: { usdRate: unknown }) => typeof row.usdRate === 'string'),
      ).toBe(true);
    });

    it('filters by repeated currency and source facets and by date range', async () => {
      const byCurrency = await http()
        .get(`${BASE}/exchange-rates?currency=VES&currency=EUR&source=BCV`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(byCurrency.body.total).toBe(2);
      const ranged = await http()
        .get(`${BASE}/exchange-rates?dateFrom=2026-10-10&dateTo=2026-10-31`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(ranged.body.total).toBe(1);
    });

    it('sorts by a whitelisted field and refuses another with VALIDATION', async () => {
      const sorted = await http()
        .get(`${BASE}/exchange-rates?sort=usdRate:asc&pageSize=50`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(sorted.body.items.map((row: { usdRate: string }) => row.usdRate)).toEqual([
        '0.86',
        '755',
        '760',
      ]);
      const bad = await http()
        .get(`${BASE}/exchange-rates?sort=id:asc`)
        .set('Authorization', as('OWNER'))
        .expect(422);
      expect(bad.body.error.fieldErrors.sort).toEqual(['validation.sort.invalid']);
      await http()
        .get(`${BASE}/exchange-rates?pageSize=7`)
        .set('Authorization', as('OWNER'))
        .expect(422);
    });
  });

  describe('lookup', () => {
    beforeEach(async () => {
      for (const [source, usdRate] of [
        ['MANUAL', '760'],
        ['BCV', '755.16'],
      ] as const) {
        await http()
          .post(`${BASE}/exchange-rates`)
          .set('Authorization', as('OWNER'))
          .send(rateBody({ date: '2026-10-09', source, usdRate }))
          .expect(200);
      }
    });

    const lookup = (query: string) =>
      http().get(`${BASE}/exchange-rates/lookup?${query}`).set('Authorization', as('VIEWER'));

    it('returns the exact-date rate with BCV first and every source as an option', async () => {
      const res = await lookup('date=2026-10-09&currency=VES').expect(200);
      expect(res.body.rate).toMatchObject({
        usdRate: '755.16',
        source: 'BCV',
        isFallback: false,
        effectiveDate: '2026-10-09',
      });
      expect(res.body.rate.options.map((o: { source: string }) => o.source)).toEqual([
        'BCV',
        'MANUAL',
      ]);
    });

    it('falls back to the latest earlier date and flags it', async () => {
      const res = await lookup('date=2026-10-20&currency=VES').expect(200);
      expect(res.body.rate).toMatchObject({ isFallback: true, effectiveDate: '2026-10-09' });
    });

    it('answers rate null when nothing exists, and USD as 1', async () => {
      expect((await lookup('date=2025-01-01&currency=VES').expect(200)).body).toEqual({
        rate: null,
      });
      expect((await lookup('date=2026-10-09&currency=EUR').expect(200)).body).toEqual({
        rate: null,
      });
      expect((await lookup('date=2026-10-09&currency=USD').expect(200)).body.rate).toEqual({
        usdRate: '1',
        source: null,
        isFallback: false,
        effectiveDate: '2026-10-09',
        options: [],
      });
    });

    it('answers VALIDATION for a malformed date or currency', async () => {
      await lookup('date=2026-02-31&currency=VES').expect(422);
      await lookup('date=2026-10-09&currency=ves').expect(422);
      await lookup('currency=VES').expect(422);
    });
  });
});
