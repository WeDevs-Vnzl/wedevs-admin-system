import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceCatalogsModule } from '../../../src/modules/settings/finance-catalogs.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma } from '../../support/db';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { createTestApp } from '../../support/test-app';
import { settingsPolicy } from './fakes/catalog-actors';

// Each request and each truncate-free cleanup touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** Rows this file creates: removed afterwards, the seeded catalog is otherwise left as it was. */
const TEST_CURRENCY = 'ZE2';
/** Clerk ids of this file's users; the prefix lets the setup remove only them. */
const CLERK_PREFIX = 'user_e2e_cat_';

describe('finance catalogs (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let fiscalBefore: unknown;
  let fiscalWasStored = false;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [FinanceCatalogsModule],
      authenticator,
      authorization: settingsPolicy,
    });
    const stored = await admin.setting.findUnique({ where: { key: 'fiscal' } });
    fiscalWasStored = stored !== null;
    fiscalBefore = stored?.value;
  });

  afterAll(async () => {
    await admin.currency.deleteMany({ where: { code: TEST_CURRENCY } });
    await admin.paymentMethod.deleteMany({ where: { code: { startsWith: 'E2E_' } } });
    await admin.expenseCategory.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    // The inactive-currency test deactivates a seeded row: put the seed values back even when it failed midway.
    await admin.currency.updateMany({
      where: { code: 'COP' },
      data: { name: 'Peso colombiano', symbol: 'COL$', decimals: 2, active: true },
    });
    if (fiscalWasStored) {
      await admin.setting.upsert({
        where: { key: 'fiscal' },
        create: { key: 'fiscal', value: fiscalBefore as object },
        update: { value: fiscalBefore as object },
      });
    } else {
      await admin.setting.deleteMany({ where: { key: 'fiscal' } });
    }
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    // Targeted deletes, not `truncateBusinessTables()`: a schema-wide TRUNCATE per test is too slow on a loaded
    // disk. Only the rows this file writes are removed: its users, the settings activity and its catalog rows.
    await admin.activityLog.deleteMany({
      where: {
        OR: [
          { entityType: 'SETTING' },
          { actor: { is: { clerkId: { startsWith: CLERK_PREFIX } } } },
        ],
      },
    });
    await admin.user.deleteMany({ where: { clerkId: { startsWith: CLERK_PREFIX } } });
    await admin.currency.deleteMany({ where: { code: TEST_CURRENCY } });
    await admin.paymentMethod.deleteMany({ where: { code: { startsWith: 'E2E_' } } });
    await admin.expenseCategory.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
    await admin.setting.deleteMany({ where: { key: 'fiscal' } });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `${CLERK_PREFIX}${role.toLowerCase()}`,
          email: `cat-${role.toLowerCase()}@example.test`,
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

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());

  describe('access', () => {
    it('refuses an unauthenticated read with UNAUTHENTICATED', async () => {
      const res = await http().get(`${BASE}/currencies`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('lets any signed-in role read the catalogs and the fiscal parameters', async () => {
      const currencies = await http()
        .get(`${BASE}/currencies`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(currencies.body.map((c: { code: string }) => c.code)).toContain('USD');
      await http().get(`${BASE}/payment-methods`).set('Authorization', as('MEMBER')).expect(200);
      await http().get(`${BASE}/expense-categories`).set('Authorization', as('MEMBER')).expect(200);
      const fiscal = await http()
        .get(`${BASE}/settings/fiscal`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(fiscal.body).toMatchObject({
        ivaDefaultRate: '16',
        igtfRate: '3',
        invoiceDefaultDueDays: 15,
      });
    });

    it('refuses a Member to create a currency with FORBIDDEN and writes nothing', async () => {
      const res = await http()
        .post(`${BASE}/currencies`)
        .set('Authorization', as('MEMBER'))
        .send({ code: TEST_CURRENCY, name: 'Zeta', symbol: 'Z' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await expect(
        admin.currency.findUnique({ where: { code: TEST_CURRENCY } }),
      ).resolves.toBeNull();
      await expect(admin.activityLog.count({ where: { action: 'SETTINGS_CHANGE' } })).resolves.toBe(
        0,
      );
    });
  });

  describe('currencies', () => {
    it('lets an Owner create a currency (201), then logs exactly one SETTINGS_CHANGE', async () => {
      const res = await http()
        .post(`${BASE}/currencies`)
        .set('Authorization', as('OWNER'))
        .send({ code: TEST_CURRENCY, name: 'Zeta', symbol: 'Z' })
        .expect(201);
      expect(res.body).toEqual({
        code: TEST_CURRENCY,
        name: 'Zeta',
        symbol: 'Z',
        decimals: 2,
        active: true,
      });

      const logs = await admin.activityLog.findMany({ where: { action: 'SETTINGS_CHANGE' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        entityType: 'SETTING',
        entityId: TEST_CURRENCY,
        changes: { currency: [null, TEST_CURRENCY] },
      });
    });

    it('answers CONFLICT on the code for a code already taken', async () => {
      const res = await http()
        .post(`${BASE}/currencies`)
        .set('Authorization', as('ADMIN'))
        .send({ code: 'USD', name: 'x', symbol: 'x' })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        fieldErrors: { code: ['catalogs.currencies.errors.codeTaken'] },
      });
    });

    it('refuses to deactivate USD with 422 on the active flag, and keeps USD active', async () => {
      const res = await http()
        .patch(`${BASE}/currencies/USD`)
        .set('Authorization', as('OWNER'))
        .send({ name: 'Dólar estadounidense', symbol: '$', decimals: 2, active: false })
        .expect(422);
      expect(res.body.error.fieldErrors).toEqual({
        active: ['catalogs.currencies.errors.usdAlwaysActive'],
      });
      await expect(admin.currency.findUnique({ where: { code: 'USD' } })).resolves.toMatchObject({
        active: true,
      });
    });

    it('edits a currency and keeps its code; an unknown code answers 404', async () => {
      await http()
        .post(`${BASE}/currencies`)
        .set('Authorization', as('OWNER'))
        .send({ code: TEST_CURRENCY, name: 'Zeta', symbol: 'Z' })
        .expect(201);
      const res = await http()
        .patch(`${BASE}/currencies/${TEST_CURRENCY}`)
        .set('Authorization', as('ADMIN'))
        .send({ name: 'Zeta renombrada', symbol: 'Z', decimals: 0, active: false })
        .expect(200);
      expect(res.body).toEqual({
        code: TEST_CURRENCY,
        name: 'Zeta renombrada',
        symbol: 'Z',
        decimals: 0,
        active: false,
      });
      await http()
        .patch(`${BASE}/currencies/NOPE`)
        .set('Authorization', as('OWNER'))
        .send({ name: 'x', symbol: 'x' })
        .expect(404);
    });

    it('hides inactive currencies from pickers and shows them with includeInactive', async () => {
      await http().patch(`${BASE}/currencies/COP`).set('Authorization', as('OWNER')).send({
        name: 'Peso colombiano',
        symbol: 'COL$',
        decimals: 2,
        active: false,
      });
      const picker = await http()
        .get(`${BASE}/currencies`)
        .set('Authorization', as('MEMBER'))
        .expect(200);
      expect(picker.body.map((c: { code: string }) => c.code)).not.toContain('COP');
      const settings = await http()
        .get(`${BASE}/currencies?includeInactive=true`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(settings.body.map((c: { code: string }) => c.code)).toContain('COP');
      await http().patch(`${BASE}/currencies/COP`).set('Authorization', as('OWNER')).send({
        name: 'Peso colombiano',
        symbol: 'COL$',
        decimals: 2,
        active: true,
      });
    });
  });

  describe('payment methods', () => {
    it('creates a method (201) and answers CONFLICT on a repeated name, case-insensitive', async () => {
      const created = await http()
        .post(`${BASE}/payment-methods`)
        .set('Authorization', as('OWNER'))
        .send({ code: 'E2E_PM', name: 'E2E Pago' })
        .expect(201);
      expect(created.body).toMatchObject({
        code: 'E2E_PM',
        name: 'E2E Pago',
        nameEn: null,
        requiresReference: true,
        suggestsIgtf: false,
        active: true,
      });
      const repeated = await http()
        .post(`${BASE}/payment-methods`)
        .set('Authorization', as('OWNER'))
        .send({ code: 'E2E_PM2', name: 'e2e pago' })
        .expect(409);
      expect(repeated.body.error.fieldErrors).toEqual({
        name: ['catalogs.paymentMethods.errors.nameTaken'],
      });
    });

    it('keeps the code on update and turns on suggestsIgtf (DT-70)', async () => {
      const created = await http()
        .post(`${BASE}/payment-methods`)
        .set('Authorization', as('OWNER'))
        .send({ code: 'E2E_PM', name: 'E2E Pago' })
        .expect(201);
      const res = await http()
        .patch(`${BASE}/payment-methods/${created.body.id}`)
        .set('Authorization', as('ADMIN'))
        .send({
          name: 'E2E Pago',
          nameEn: 'E2E Pay',
          requiresReference: false,
          suggestsIgtf: true,
          active: true,
        })
        .expect(200);
      expect(res.body).toMatchObject({ code: 'E2E_PM', suggestsIgtf: true, nameEn: 'E2E Pay' });
    });
  });

  describe('expense categories (two levels)', () => {
    it('refuses a child under a child with 422, and lists the root with its child', async () => {
      const root = await http()
        .post(`${BASE}/expense-categories`)
        .set('Authorization', as('OWNER'))
        .send({ name: 'E2E Raiz', color: '#123456' })
        .expect(201);
      const child = await http()
        .post(`${BASE}/expense-categories`)
        .set('Authorization', as('OWNER'))
        .send({ name: 'E2E Hijo', parentId: root.body.id })
        .expect(201);
      const grandchild = await http()
        .post(`${BASE}/expense-categories`)
        .set('Authorization', as('OWNER'))
        .send({ name: 'E2E Nieto', parentId: child.body.id })
        .expect(422);
      expect(grandchild.body.error.fieldErrors).toEqual({
        parentId: ['catalogs.expenseCategories.errors.parentNotRoot'],
      });

      const tree = await http()
        .get(`${BASE}/expense-categories`)
        .set('Authorization', as('MEMBER'))
        .expect(200);
      const node = tree.body.find((n: { id: string }) => n.id === root.body.id);
      expect(node.children.map((c: { name: string }) => c.name)).toEqual(['E2E Hijo']);
    });
  });

  describe('fiscal parameters', () => {
    it('refuses a default VAT rate outside the allowed set with 422', async () => {
      const res = await http()
        .patch(`${BASE}/settings/fiscal`)
        .set('Authorization', as('OWNER'))
        .send({ ivaRates: ['16', '0'], ivaDefaultRate: '8' })
        .expect(422);
      expect(res.body.error.fieldErrors).toEqual({
        ivaDefaultRate: ['settings.validation.defaultIvaRateNotAllowed'],
      });
    });

    it('refuses an IGTF currency that is not in the catalog with 422', async () => {
      const res = await http()
        .patch(`${BASE}/settings/fiscal`)
        .set('Authorization', as('OWNER'))
        .send({ igtfCurrencies: ['ZZZ'] })
        .expect(422);
      expect(res.body.error.fieldErrors).toEqual({
        igtfCurrencies: ['catalogs.rates.errors.unknownCurrency'],
      });
    });

    it('saves a fiscal update with one SETTINGS_CHANGE, and none for an identical save', async () => {
      const body = {
        ivaRates: ['16', '8', '0', '12'],
        ivaDefaultRate: '12',
        igtfRate: '3',
        igtfCurrencies: ['USD', 'EUR'],
        invoiceDefaultDueDays: 30,
      };
      const saved = await http()
        .patch(`${BASE}/settings/fiscal`)
        .set('Authorization', as('OWNER'))
        .send(body)
        .expect(200);
      expect(saved.body).toEqual(body);

      const logs = () =>
        admin.activityLog.count({
          where: { action: 'SETTINGS_CHANGE', entityType: 'SETTING', entityId: 'fiscal' },
        });
      await expect(logs()).resolves.toBe(1);

      await http()
        .patch(`${BASE}/settings/fiscal`)
        .set('Authorization', as('ADMIN'))
        .send(body)
        .expect(200);
      await expect(logs()).resolves.toBe(1);

      const read = await http()
        .get(`${BASE}/settings/fiscal`)
        .set('Authorization', as('MEMBER'))
        .expect(200);
      expect(read.body).toEqual(body);
    });

    it('refuses a Member to update the fiscal parameters with FORBIDDEN', async () => {
      await http()
        .patch(`${BASE}/settings/fiscal`)
        .set('Authorization', as('MEMBER'))
        .send({ invoiceDefaultDueDays: 1 })
        .expect(403);
      await expect(admin.setting.findUnique({ where: { key: 'fiscal' } })).resolves.toBeNull();
    });
  });
});
