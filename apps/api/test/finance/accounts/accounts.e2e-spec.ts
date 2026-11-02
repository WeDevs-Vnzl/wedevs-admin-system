import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsModule } from '../../../src/modules/finance/accounts.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
const CLERK_PREFIX = 'user_e2e_accounts_';

describe('accounts, transfers and movements (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  const tokens: Partial<Record<UserRole, string>> = {};
  const userIds: Partial<Record<UserRole, string>> = {};

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
    // 1 USDT = 1.01 USD and 755.16 VES per USD, on the day of the fixtures.
    await admin.exchangeRate.createMany({
      data: [
        { date: new Date('2026-01-01'), currency: 'USDT', usdRate: '0.9901', source: 'MANUAL' },
        { date: new Date('2026-01-01'), currency: 'VES', usdRate: '755.16', source: 'MANUAL' },
      ],
    });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `${CLERK_PREFIX}${role.toLowerCase()}`,
          email: `accounts-${role.toLowerCase()}@example.test`,
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
  const post = (path: string, body: unknown, role: UserRole = 'OWNER') =>
    http()
      .post(`${BASE}${path}`)
      .set('Authorization', as(role))
      .send(body as object);
  const get = (path: string, role: UserRole = 'OWNER') =>
    http().get(`${BASE}${path}`).set('Authorization', as(role));

  const accountBody = (over: Record<string, unknown> = {}) => ({
    name: 'Zelle USD',
    type: 'BILLETERA_DIGITAL',
    currency: 'USD',
    openingBalance: '1000.00',
    openingDate: '2026-01-01',
    ...over,
  });
  const createAccount = async (over: Record<string, unknown> = {}) =>
    (await post('/accounts', accountBody(over)).expect(201)).body as { id: string };
  const movement = (over: Record<string, unknown> = {}) => ({
    type: 'APORTE_CAPITAL',
    date: '2026-02-01',
    amount: '500.00',
    usdRate: '1',
    partnerId: userIds.ADMIN,
    description: 'Aporte',
    ...over,
  });
  const transferBody = (fromAccountId: string, toAccountId: string, over = {}) => ({
    date: '2026-04-01',
    fromAccountId,
    toAccountId,
    amountFrom: '100',
    amountTo: '99',
    usdRate: '1',
    ...over,
  });

  /** Zelle USD 1000 + 500 - 200 - 100 = 1200; Binance USDT 99; Banco VES 5000 - 1500 = 3500. */
  async function seedFixtures() {
    const zelle = await createAccount({ identifierMasked: 'cobros@example.test' });
    const binance = await createAccount({
      name: 'Binance USDT',
      type: 'WALLET_CRIPTO',
      currency: 'USDT',
      openingBalance: '0',
    });
    const ves = await createAccount({
      name: 'Banco nacional VES',
      type: 'BANCO_NACIONAL',
      currency: 'VES',
      openingBalance: '5000.00',
    });
    await post(`/accounts/${zelle.id}/movements`, movement()).expect(201);
    await post(
      `/accounts/${zelle.id}/movements`,
      movement({
        type: 'RETIRO_SOCIO',
        date: '2026-03-01',
        amount: '200.00',
        description: 'Retiro',
      }),
    ).expect(201);
    await post('/transfers', transferBody(zelle.id, binance.id)).expect(201);
    await post(
      `/accounts/${ves.id}/movements`,
      movement({
        type: 'AJUSTE',
        date: '2026-05-01',
        amount: '-1500.00',
        usdRate: '755.16',
        partnerId: undefined,
        description: 'Ajuste',
      }),
    ).expect(201);
    return { zelle: zelle.id, binance: binance.id, ves: ves.id };
  }

  describe('access', () => {
    it('answers UNAUTHENTICATED on every route without a session', async () => {
      for (const call of [
        () => http().get(`${BASE}/accounts`),
        () => http().get(`${BASE}/accounts/partners`),
        () => http().post(`${BASE}/accounts`).send({}),
        () => http().get(`${BASE}/accounts/acc_x`),
        () => http().patch(`${BASE}/accounts/acc_x`).send({}),
        () => http().get(`${BASE}/accounts/acc_x/ledger`),
        () => http().get(`${BASE}/accounts/acc_x/balance`),
        () => http().post(`${BASE}/accounts/acc_x/reconcile`).send({}),
        () => http().post(`${BASE}/accounts/acc_x/movements`).send({}),
        () => http().post(`${BASE}/transfers`).send({}),
      ]) {
        expect((await call().expect(401)).body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('gives Member and Viewer FORBIDDEN on every route and writes nothing (PRD §4.3)', async () => {
      const { zelle, binance } = await seedFixtures();
      const accounts = await admin.account.count();
      const activity = await admin.activityLog.count();
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        const calls = [
          () => get('/accounts', role),
          () => get('/accounts/partners', role),
          () => get(`/accounts/${zelle}`, role),
          () => get(`/accounts/${zelle}/ledger`, role),
          () => get(`/accounts/${zelle}/balance`, role),
          () => post('/accounts', accountBody(), role),
          () =>
            http()
              .patch(`${BASE}/accounts/${zelle}`)
              .set('Authorization', as(role))
              .send({ name: 'x' }),
          () =>
            post(
              `/accounts/${zelle}/reconcile`,
              { date: '2026-10-09', statementBalance: '1' },
              role,
            ),
          () => post(`/accounts/${zelle}/movements`, movement(), role),
          () => post('/transfers', transferBody(zelle, binance), role),
        ];
        for (const call of calls) {
          const res = await call().expect(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
      expect(await admin.account.count()).toBe(accounts);
      expect(await admin.activityLog.count()).toBe(activity);
    });
  });

  describe('accounts', () => {
    it('creates an account with the identifier masked, the opening as balance and the USD value', async () => {
      const res = await post(
        '/accounts',
        accountBody({ identifierMasked: '0102-0123-45-6789012345', notes: ' hola ' }),
      ).expect(201);
      expect(res.body).toMatchObject({
        name: 'Zelle USD',
        currency: 'USD',
        identifierMasked: '•••• 2345',
        openingBalance: '1000.00',
        balance: '1000.00',
        balanceUsd: '1000.00',
        active: true,
        notes: 'hola',
      });
      const stored = await admin.account.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.identifierMasked).toBe('•••• 2345');
      const log = await admin.activityLog.findFirstOrThrow({ where: { entityType: 'ACCOUNT' } });
      expect(log).toMatchObject({
        action: 'CREATE',
        entityId: res.body.id,
        actorId: userIds.OWNER,
      });
      expect(JSON.stringify(log)).not.toContain('6789012345');
      expect(
        await admin.searchEntry.count({ where: { entityType: 'ACCOUNT', entityId: res.body.id } }),
      ).toBe(1);
    });

    it('answers VALIDATION with field errors and writes nothing', async () => {
      const res = await post(
        '/accounts',
        accountBody({ name: '', currency: 'XYZ', openingBalance: '1.234' }),
      ).expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(Object.keys(res.body.error.fieldErrors)).toEqual(
        expect.arrayContaining(['name', 'openingBalance']),
      );
      const unknown = await post('/accounts', accountBody({ currency: 'XYZ' })).expect(422);
      expect(unknown.body.error.fieldErrors.currency).toEqual([
        'accounts.validation.unknownCurrency',
      ]);
      expect(await admin.account.count()).toBe(0);
    });

    it('values the USDT account in USD at 1 USDT = 1.01 USD (HU-15 CA1)', async () => {
      const { binance } = await seedFixtures();
      const res = await get(`/accounts/${binance}`).expect(200);
      expect(res.body).toMatchObject({ balance: '99.00', balanceUsd: '99.99' });
    });

    it('lists active accounts by default with the envelope, and honors the facets and sorts', async () => {
      const { zelle, binance } = await seedFixtures();
      await http()
        .patch(`${BASE}/accounts/${binance}`)
        .set('Authorization', as('ADMIN'))
        .send({ active: false })
        .expect(200);
      const active = await get('/accounts?pageSize=25').expect(200);
      expect(active.body).toMatchObject({ total: 2, page: 1, pageSize: 25, pageCount: 1 });
      expect(active.body.items.map((a: { name: string }) => a.name)).toEqual([
        'Banco nacional VES',
        'Zelle USD',
      ]);
      const all = await get('/accounts?includeInactive=true&sort=balance:desc').expect(200);
      expect(all.body.items.map((a: { balance: string }) => a.balance)).toEqual([
        '3500.00',
        '1200.00',
        '99.00',
      ]);
      const inactive = await get('/accounts?status=inactive').expect(200);
      expect(inactive.body.items.map((a: { id: string }) => a.id)).toEqual([binance]);
      const typed = await get('/accounts?type=BILLETERA_DIGITAL&currency=USD').expect(200);
      expect(typed.body.items.map((a: { id: string }) => a.id)).toEqual([zelle]);
      const bad = await get('/accounts?sort=holderName:asc').expect(422);
      expect(bad.body.error.fieldErrors.sort).toEqual(['validation.sort.invalid']);
    });

    it('edits an account, keeps the identifier on a blank one and locks the currency with movements', async () => {
      const { zelle, binance } = await seedFixtures();
      const patch = (id: string, body: object) =>
        http().patch(`${BASE}/accounts/${id}`).set('Authorization', as('OWNER')).send(body);
      const renamed = await patch(zelle, { name: 'Zelle principal', identifierMasked: '' }).expect(
        200,
      );
      expect(renamed.body).toMatchObject({
        name: 'Zelle principal',
        identifierMasked: 'cobr…test',
      });
      const locked = await patch(zelle, { currency: 'EUR' }).expect(422);
      expect(locked.body.error.fieldErrors.currency).toEqual([
        'accounts.validation.currencyLocked',
      ]);
      const reopened = await patch(binance, { openingBalance: '10.00' }).expect(200);
      expect(reopened.body.balance).toBe('109.00');
      expect((await patch('acc_missing', { name: 'x' })).status).toBe(404);
    });

    it('answers NOT_FOUND for an unknown account on every account route', async () => {
      for (const path of [
        '/accounts/acc_missing',
        '/accounts/acc_missing/ledger',
        '/accounts/acc_missing/balance',
      ]) {
        expect((await get(path).expect(404)).body.error.code).toBe('NOT_FOUND');
      }
      await post('/accounts/acc_missing/reconcile', {
        date: '2026-10-09',
        statementBalance: '1',
      }).expect(404);
      await post('/accounts/acc_missing/movements', movement()).expect(404);
    });

    it('lists the users who can be a partner', async () => {
      const res = await get('/accounts/partners', 'ADMIN').expect(200);
      expect(res.body.map((p: { id: string }) => p.id).sort()).toEqual(
        Object.values(userIds).sort(),
      );
    });
  });

  describe('HU-15: balances, ledger and reconciliation', () => {
    it('CA1: each balance comes from its opening, contributions, withdrawals, transfers and adjustments', async () => {
      const { zelle, binance, ves } = await seedFixtures();
      const balances = await Promise.all(
        [zelle, binance, ves].map(async (id) => (await get(`/accounts/${id}`)).body.balance),
      );
      expect(balances).toEqual(['1200.00', '99.00', '3500.00']);
      const cached = await admin.account.findMany({ orderBy: { createdAt: 'asc' } });
      expect(cached.map((a) => a.balance.toFixed(2)).sort()).toEqual([
        '1200.00',
        '3500.00',
        '99.00',
      ]);
    });

    it('CA2: the ledger lists every entry in date order and ends on the account balance, RETIRO_SOCIO included', async () => {
      const { zelle } = await seedFixtures();
      const res = await get(`/accounts/${zelle}/ledger?pageSize=100`).expect(200);
      expect(
        res.body.items.map((r: { kind: string; amount: string; balance: string }) => [
          r.kind,
          r.amount,
          r.balance,
        ]),
      ).toEqual([
        ['OPENING_BALANCE', '1000.00', '1000.00'],
        ['APORTE_CAPITAL', '500.00', '1500.00'],
        ['RETIRO_SOCIO', '-200.00', '1300.00'],
        ['TRANSFER_OUT', '-100.00', '1200.00'],
      ]);
      expect(res.body.items[1]).toMatchObject({
        source: { type: 'ACCOUNT_MOVEMENT', label: 'Aporte' },
        description: 'Aporte',
      });
      expect(res.body.items.at(-1).balance).toBe((await get(`/accounts/${zelle}`)).body.balance);
      const filtered = await get(
        `/accounts/${zelle}/ledger?kind=TRANSFER_OUT&dateFrom=2026-04-01`,
      ).expect(200);
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].balance).toBe('1200.00');
      expect(
        (await get(`/accounts/${zelle}/ledger?kind=NOPE`).expect(422)).body.error.fieldErrors,
      ).toHaveProperty('kind');
    });

    it('answers the balance at a date, today when omitted', async () => {
      const { zelle } = await seedFixtures();
      expect(
        (await get(`/accounts/${zelle}/balance?at=2026-02-15`).expect(200)).body,
      ).toMatchObject({
        accountId: zelle,
        currency: 'USD',
        at: '2026-02-15',
        balance: '1500.00',
        balanceUsd: '1500.00',
      });
      expect((await get(`/accounts/${zelle}/balance`).expect(200)).body.balance).toBe('1200.00');
      await get(`/accounts/${zelle}/balance?at=2026-02-30`).expect(422);
    });

    it('CA3: a difference suggests an AJUSTE, is stored, and recording the adjustment closes it', async () => {
      const { zelle } = await seedFixtures();
      const res = await post(`/accounts/${zelle}/reconcile`, {
        date: '2026-10-09',
        statementBalance: '1300.00',
        notes: 'Extracto',
      }).expect(200);
      expect(res.body).toMatchObject({
        accountId: zelle,
        systemBalance: '1200.00',
        difference: '100.00',
        suggestedAdjustment: '100.00',
        notes: 'Extracto',
      });
      const stored = await admin.accountReconciliation.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(stored.difference.toFixed(2)).toBe('100.00');
      expect((await get(`/accounts/${zelle}`)).body.balance).toBe('1200.00');
      await post(
        `/accounts/${zelle}/movements`,
        movement({
          type: 'AJUSTE',
          date: '2026-10-09',
          amount: res.body.suggestedAdjustment,
          partnerId: undefined,
          description: 'Ajuste por conciliación',
        }),
      ).expect(201);
      expect((await get(`/accounts/${zelle}`)).body.balance).toBe('1300.00');
      const match = await post(`/accounts/${zelle}/reconcile`, {
        date: '2026-10-09',
        statementBalance: '1300.00',
      }).expect(200);
      expect(match.body).toMatchObject({ difference: '0.00', suggestedAdjustment: null });
    });
  });

  describe('HU-16: transfers', () => {
    it('CA1: 100 USD to 99 USDT debits 100 from the origin and credits 99 to the destination', async () => {
      const { zelle, binance } = await seedFixtures();
      const res = await post(
        '/transfers',
        transferBody(zelle, binance, { reference: 'T-1' }),
      ).expect(201);
      expect(res.body).toMatchObject({
        fromAccount: { type: 'ACCOUNT', id: zelle, label: 'Zelle USD' },
        toAccount: { type: 'ACCOUNT', id: binance },
        amountFrom: '100.00',
        amountTo: '99.00',
        feeAmount: '0.00',
        amountUsd: '100.00',
        reference: 'T-1',
      });
      expect((await get(`/accounts/${zelle}`)).body.balance).toBe('1100.00');
      expect((await get(`/accounts/${binance}`)).body.balance).toBe('198.00');
      const facts = await admin.financeFact.findMany({
        where: { kind: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } },
      });
      expect(facts.filter((f) => f.accountId === zelle && f.kind === 'TRANSFER_OUT').length).toBe(
        2,
      );
      const log = await admin.activityLog.findFirstOrThrow({
        where: { entityType: 'TRANSFER', entityId: res.body.id },
      });
      expect(log.action).toBe('CREATE');
    });

    it('debits the fee on top of the amount sent', async () => {
      const { zelle, binance } = await seedFixtures();
      await post(
        '/transfers',
        transferBody(zelle, binance, { amountTo: '98', feeAmount: '2' }),
      ).expect(201);
      expect((await get(`/accounts/${zelle}`)).body.balance).toBe('1098.00');
    });

    it('CA2: refuses a transfer from an account to itself and writes nothing', async () => {
      const { zelle } = await seedFixtures();
      const before = await admin.accountTransfer.count();
      const res = await post('/transfers', transferBody(zelle, zelle)).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { toAccountId: ['accounts.validation.sameAccount'] },
      });
      expect(await admin.accountTransfer.count()).toBe(before);
    });

    it('refuses an inactive or unknown account and a USD snapshot rate other than 1', async () => {
      const { zelle, binance } = await seedFixtures();
      await http()
        .patch(`${BASE}/accounts/${binance}`)
        .set('Authorization', as('OWNER'))
        .send({ active: false })
        .expect(200);
      const inactive = await post('/transfers', transferBody(zelle, binance)).expect(422);
      expect(inactive.body.error.fieldErrors.toAccountId).toEqual(['accounts.validation.inactive']);
      await post('/transfers', transferBody(zelle, 'acc_missing')).expect(404);
      const other = await createAccount({ name: 'Otra' });
      const rate = await post('/transfers', transferBody(zelle, other.id, { usdRate: '2' })).expect(
        422,
      );
      expect(rate.body.error.fieldErrors.usdRate).toEqual(['accounts.validation.usdRateMustBeOne']);
    });
  });

  describe('manual movements', () => {
    it('stores a withdrawal with its partner and the USD snapshot, and lowers the balance', async () => {
      const { zelle } = await seedFixtures();
      const res = await post(
        `/accounts/${zelle}/movements`,
        movement({ type: 'RETIRO_SOCIO', amount: '50.00', description: 'Retiro de prueba' }),
      ).expect(201);
      expect(res.body).toMatchObject({
        account: { type: 'ACCOUNT', id: zelle },
        type: 'RETIRO_SOCIO',
        amount: '50.00',
        amountUsd: '50.00',
        partner: { type: 'USER', id: userIds.ADMIN },
      });
      expect((await get(`/accounts/${zelle}`)).body.balance).toBe('1150.00');
      const stored = await admin.accountMovement.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.amount.toFixed(2)).toBe('50.00');
      expect(stored.createdById).toBe(userIds.OWNER);
    });

    it('keeps the sign of an AJUSTE, converts it with its sign and ignores the partner', async () => {
      const { ves } = await seedFixtures();
      const res = await post(
        `/accounts/${ves}/movements`,
        movement({
          type: 'AJUSTE',
          amount: '-755.16',
          usdRate: '755.16',
          partnerId: userIds.ADMIN,
          description: 'Ajuste',
        }),
      ).expect(201);
      expect(res.body).toMatchObject({ amount: '-755.16', amountUsd: '-1.00', partner: null });
      expect((await get(`/accounts/${ves}`)).body.balance).toBe('2744.84');
    });

    it('refuses a missing or unknown partner, a zero adjustment and a non-positive withdrawal', async () => {
      const { zelle } = await seedFixtures();
      for (const partnerId of [undefined, 'usr_unknown']) {
        const res = await post(`/accounts/${zelle}/movements`, movement({ partnerId })).expect(422);
        expect(res.body.error.fieldErrors.partnerId).toEqual([
          'accounts.validation.partnerRequired',
        ]);
      }
      const zero = await post(
        `/accounts/${zelle}/movements`,
        movement({ type: 'AJUSTE', amount: '0.00' }),
      ).expect(422);
      expect(zero.body.error.fieldErrors.amount).toEqual(['accounts.validation.adjustmentNonZero']);
      const negative = await post(
        `/accounts/${zelle}/movements`,
        movement({ amount: '-5' }),
      ).expect(422);
      expect(negative.body.error.fieldErrors.amount).toEqual(['validation.money.mustBePositive']);
      expect(await admin.accountMovement.count({ where: { accountId: zelle } })).toBe(2);
    });
  });
});
