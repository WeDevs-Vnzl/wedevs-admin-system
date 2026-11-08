import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { PAYMENT_PROVIDER } from '../../../src/modules/integrations/application/ports/payment-provider.port';
import { createStripePaymentProvider } from '../../../src/modules/integrations/infrastructure/stripe/stripe-payment-provider';
import { PaymentLinksModule } from '../../../src/modules/integrations/payment-links.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import type { DbClient } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { seedAccount, seedClient, seedInvoice } from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';
import {
  ScriptedStripeFetch,
  scriptedStripeApi,
  testApiKey,
  testWebhookSecret,
} from '../stripe/scripted-stripe';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1/invoices';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
const seedDb = admin as unknown as DbClient;
const REQ = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

describe('payment-link routes (e2e): choice 1, 3, 5, DT-196, DT-197', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let script: ScriptedStripeFetch;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    process.env.FEATURE_STRIPE = 'true';
    process.env.STRIPE_SECRET_KEY = testApiKey();
    process.env.STRIPE_WEBHOOK_SECRET = testWebhookSecret();
    script = new ScriptedStripeFetch();
    scriptedStripeApi(script);
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [PaymentLinksModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        {
          token: PAYMENT_PROVIDER,
          useValue: createStripePaymentProvider({
            apiKey: testApiKey(),
            webhookSecret: testWebhookSecret(),
            returnUrl: 'https://app.example.test',
            httpClient: script.httpClient(),
          }),
        },
      ],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
    delete process.env.FEATURE_STRIPE;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    for (const role of ['OWNER', 'MEMBER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_lnk_${role.toLowerCase()}`,
          email: `lnk-${role.toLowerCase()}@example.test`,
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
    await seedClient(seedDb, 'cli_e2e');
    await seedAccount(seedDb, 'acc_stripe', 'USD');
    await seedAccount(seedDb, 'acc_stripe_eur', 'EUR');
    await mapStripeTo('acc_stripe');
    await seedInvoice(seedDb, {
      id: 'inv_usd',
      clientId: 'cli_e2e',
      lines: [{ id: 'l1', projectId: null, unitPrice: '100.00', ivaRate: null }],
    });
    await seedInvoice(seedDb, {
      id: 'inv_ves',
      clientId: 'cli_e2e',
      currency: 'VES',
      usdRate: '40',
      lines: [{ id: 'l2', projectId: null, unitPrice: '4000.00', ivaRate: null }],
    });
  });

  /** Settings survive `truncateBusinessTables`, so the mapping is written again before every test. */
  const mapStripeTo = async (accountId: string | null) => {
    const value = { stripe: accountId ? { accountId, paymentMethodId: 'pm_e2e' } : null };
    await admin.setting.upsert({
      where: { key: 'integrations.mapping' },
      create: { key: 'integrations.mapping', value },
      update: { value },
    });
  };

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const create = (invoice: string, amount: string, requestId: string, role: UserRole = 'OWNER') =>
    request(app.getHttpServer())
      .post(`${BASE}/${invoice}/payment-links`)
      .set('Authorization', as(role))
      .send({ amount, requestId });
  const list = (invoice: string, role: UserRole = 'OWNER') =>
    request(app.getHttpServer())
      .get(`${BASE}/${invoice}/payment-links`)
      .set('Authorization', as(role));

  it('answers 403 to a Member on create, list and deactivate', async () => {
    expect((await create('inv_usd', '10.00', REQ(1), 'MEMBER')).status).toBe(403);
    expect((await list('inv_usd', 'MEMBER')).status).toBe(403);
    const res = await request(app.getHttpServer())
      .post(`${BASE}/inv_usd/payment-links/lnk/deactivate`)
      .set('Authorization', as('MEMBER'));
    expect(res.status).toBe(403);
    expect(await admin.invoicePaymentLink.count()).toBe(0);
  });

  it('allows 40 then 60 on a balance of 100 and refuses a third of 0.01', async () => {
    const first = await create('inv_usd', '40.00', REQ(1));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      amount: '40.00',
      currency: 'USD',
      status: 'ACTIVE',
      invoiceId: 'inv_usd',
    });
    expect(first.body.url).toMatch(/^https:\/\//);
    const second = await create('inv_usd', '60.00', REQ(2));
    expect(second.status).toBe(201);

    const third = await create('inv_usd', '0.01', REQ(3));
    expect(third.status).toBe(422);
    expect(third.body.error.code).toBe('VALIDATION');
    expect(third.body.error.fieldErrors).toEqual({
      amount: ['validation.paymentLinkExceedsCapacity'],
    });

    const listed = await list('inv_usd');
    expect(listed.status).toBe(200);
    expect(listed.body.capacity).toBe('0.00');
    expect(listed.body.links.map((l: { amount: string }) => l.amount)).toEqual(['60.00', '40.00']);
    expect(await admin.invoicePaymentLink.count()).toBe(2);
    const log = await admin.activityLog.findMany({ where: { entityType: 'PAYMENT_LINK' } });
    expect(log).toHaveLength(2);
  });

  it('returns the same link for a repeated requestId', async () => {
    const a = await create('inv_usd', '25.00', REQ(4));
    const b = await create('inv_usd', '25.00', REQ(4));
    expect(b.body.id).toBe(a.body.id);
    expect(await admin.invoicePaymentLink.count()).toBe(1);
  });

  it('refuses a VES invoice with paymentLinkCurrencyUnsupported', async () => {
    const res = await create('inv_ves', '100.00', REQ(5));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION',
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect(await admin.invoicePaymentLink.count()).toBe(0);
    expect((await list('inv_ves')).body.capacity).toBe('0.00');
  });

  it('refuses a link when Stripe has no mapping or the mapped account is in another currency (capacity 0)', async () => {
    await mapStripeTo(null);
    const unmapped = await create('inv_usd', '10.00', REQ(9));
    expect(unmapped.status).toBe(422);
    expect(unmapped.body.error).toMatchObject({
      code: 'VALIDATION',
      message: 'validation.paymentLinkCurrencyUnsupported',
    });
    expect((await list('inv_usd')).body.capacity).toBe('0.00');

    await mapStripeTo('acc_stripe_eur');
    const wrongCurrency = await create('inv_usd', '10.00', REQ(9));
    expect(wrongCurrency.status).toBe(422);
    expect(wrongCurrency.body.error.message).toBe('validation.paymentLinkCurrencyUnsupported');
    expect((await list('inv_usd')).body.capacity).toBe('0.00');
    expect(await admin.invoicePaymentLink.count()).toBe(0);
  });

  it('deactivates a link, frees its capacity and is idempotent', async () => {
    const link = (await create('inv_usd', '70.00', REQ(6))).body;
    const path = `${BASE}/inv_usd/payment-links/${link.id}/deactivate`;
    const first = await request(app.getHttpServer()).post(path).set('Authorization', as('OWNER'));
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('DEACTIVATED');
    const again = await request(app.getHttpServer()).post(path).set('Authorization', as('OWNER'));
    expect(again.status).toBe(200);
    expect((await list('inv_usd')).body.capacity).toBe('100.00');
  });

  it('validates the body shape and the request id', async () => {
    const badAmount = await create('inv_usd', 'ten', REQ(7));
    expect(badAmount.status).toBe(422);
    const badRequest = await create('inv_usd', '10.00', 'not-a-uuid');
    expect(badRequest.status).toBe(422);
    expect((await create('inv_missing', '10.00', REQ(8))).status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app.getHttpServer()).get(`${BASE}/inv_usd/payment-links`);
    expect(res.status).toBe(401);
  });
});
