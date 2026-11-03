import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAYMENT_PROVIDER } from '../../../src/modules/integrations/application/ports/payment-provider.port';
import { createStripePaymentProvider } from '../../../src/modules/integrations/infrastructure/stripe/stripe-payment-provider';
import { StripeModule } from '../../../src/modules/integrations/stripe.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { IntegrationMappingModule } from '../../../src/modules/settings/integration-mapping.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { DbClient } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { seedAccount, seedClient, seedInvoice } from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';
import {
  ScriptedStripeFetch,
  signPayload,
  stripeError,
  testApiKey,
  testWebhookSecret,
} from '../stripe/scripted-stripe';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PATH = '/api/v1/webhooks/stripe';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
/** The seed helpers take the transactional client type; the plain client has the same delegates. */
const seedDb = admin as unknown as DbClient;
const secret = testWebhookSecret();
const apiKey = testApiKey();
const created = Math.floor(Date.now() / 1000) - 3600;

const intent = (id: string, metadata: Record<string, string>) => ({
  id,
  object: 'payment_intent',
  amount: 6000,
  amount_received: 6000,
  currency: 'usd',
  status: 'succeeded',
  created,
  metadata,
  latest_charge: null,
});

const eventBody = (id: string, type: string, object: unknown) =>
  JSON.stringify({ id, object: 'event', type, created, data: { object } });

describe('POST /webhooks/stripe (e2e): DT-183, A6, A11', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let ownerToken: string;
  let ownerId: string;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = apiKey;
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const script = new ScriptedStripeFetch().on((r) => {
      if (r.method !== 'GET' || !r.url.pathname.startsWith('/v1/payment_intents/'))
        return undefined;
      const id = r.url.pathname.split('/').pop() ?? '';
      if (id === 'pi_link')
        return { status: 200, body: intent(id, { invoiceId: 'inv_e2e', linkId: 'lnk_e2e' }) };
      if (id === 'pi_loose') return { status: 200, body: intent(id, { clientId: 'cli_e2e' }) };
      return stripeError(404, 'invalid_request_error', 'resource_missing');
    });
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [StripeModule, IntegrationMappingModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        {
          token: PAYMENT_PROVIDER,
          useValue: createStripePaymentProvider({
            apiKey,
            webhookSecret: secret,
            returnUrl: 'https://app.example.test',
            httpClient: script.httpClient(),
          }),
        },
      ],
    });
  });

  afterAll(async () => {
    await admin.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    const owner = await admin.user.create({
      data: { clerkId: 'user_e2e_hook', email: 'hook@example.test', name: 'Owner', role: 'OWNER' },
    });
    ownerId = owner.id;
    const user: CurrentUser = {
      userId: owner.id,
      clerkId: owner.clerkId,
      role: 'OWNER',
      email: owner.email,
      name: owner.name,
    };
    ownerToken = authenticator.issue(user);
    await seedClient(seedDb, 'cli_e2e');
    await seedAccount(seedDb, 'acc_e2e', 'USD');
    await seedInvoice(seedDb, {
      id: 'inv_e2e',
      clientId: 'cli_e2e',
      lines: [{ id: 'l1', projectId: null, unitPrice: '100.00', ivaRate: null }],
    });
    await admin.invoicePaymentLink.create({
      data: {
        id: 'lnk_e2e',
        invoiceId: 'inv_e2e',
        requestId: '11111111-1111-4111-8111-111111111111',
        provider: 'STRIPE',
        externalId: 'cs_e2e',
        url: 'https://checkout.example.test/cs_e2e',
        amount: '60.00',
        currency: 'USD',
        status: 'ACTIVE',
        createdById: ownerId,
      },
    });
    const method = await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } });
    await request(app.getHttpServer())
      .put('/api/v1/settings/integrations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ stripe: { accountId: 'acc_e2e', paymentMethodId: method.id } })
      .expect(200);
  });

  const deliver = (body: string, secretUsed = secret, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('stripe-signature', signPayload(body, secretUsed))
      .set(headers)
      .send(body);

  const linkPayment = () =>
    eventBody('evt_1', 'payment_intent.succeeded', {
      id: 'pi_link',
      object: 'payment_intent',
      metadata: { invoiceId: 'inv_e2e', linkId: 'lnk_e2e' },
    });

  it('records a PENDIENTE_VERIFICACION payment with its activity and completes the link', async () => {
    const res = await deliver(linkPayment());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, outcome: 'processed' });

    const payments = await admin.payment.findMany();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: 'PENDIENTE_VERIFICACION',
      clientId: 'cli_e2e',
      accountId: 'acc_e2e',
      currency: 'USD',
      externalProvider: 'STRIPE',
      externalId: 'pi_link',
    });
    expect(payments[0]?.amount.toFixed(2)).toBe('60.00');
    expect(await admin.paymentAllocation.count()).toBe(0);

    const log = await admin.activityLog.findMany({ where: { entityType: 'PAYMENT' } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'CREATE', actorType: 'SYSTEM', actorId: null });
    expect(log[0]?.metadata).toMatchObject({
      provider: 'STRIPE',
      eventId: 'evt_1',
      linkId: 'lnk_e2e',
    });

    const link = await admin.invoicePaymentLink.findUniqueOrThrow({ where: { id: 'lnk_e2e' } });
    expect(link).toMatchObject({ status: 'COMPLETED', paymentId: payments[0]?.id });
    const events = await admin.integrationEvent.findMany();
    expect(events).toMatchObject([
      { eventId: 'evt_1', outcome: 'PROCESSED', entityType: 'PAYMENT' },
    ]);
  });

  it('answers duplicate for the same event again and writes no second row', async () => {
    await deliver(linkPayment()).expect(200);
    const again = await deliver(linkPayment());
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ received: true, outcome: 'duplicate' });
    expect(await admin.payment.count()).toBe(1);
    expect(await admin.integrationEvent.count()).toBe(1);
    expect(await admin.activityLog.count({ where: { entityType: 'PAYMENT' } })).toBe(1);
  });

  it('answers duplicate for the second event Stripe sends about the same payment', async () => {
    await deliver(linkPayment()).expect(200);
    const session = eventBody('evt_2', 'checkout.session.completed', {
      id: 'cs_e2e',
      object: 'checkout.session',
      payment_status: 'paid',
      payment_intent: 'pi_link',
      metadata: { invoiceId: 'inv_e2e', linkId: 'lnk_e2e' },
    });
    const res = await deliver(session);
    expect(res.body).toEqual({ received: true, outcome: 'duplicate' });
    expect(await admin.payment.count()).toBe(1);
    expect(await admin.integrationEvent.count()).toBe(2);
  });

  it('answers 401 UNAUTHENTICATED for a bad signature and writes nothing', async () => {
    const res = await deliver(linkPayment(), testWebhookSecret());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    const missing = await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .send(linkPayment());
    expect(missing.status).toBe(401);
    expect(await admin.payment.count()).toBe(0);
    expect(await admin.integrationEvent.count()).toBe(0);
    expect(await admin.activityLog.count({ where: { entityType: 'PAYMENT' } })).toBe(0);
  });

  it('resolves the client from metadata.clientId when no link is named', async () => {
    const body = eventBody('evt_loose', 'payment_intent.succeeded', {
      id: 'pi_loose',
      object: 'payment_intent',
      metadata: { clientId: 'cli_e2e' },
    });
    expect((await deliver(body)).body.outcome).toBe('processed');
    const payment = await admin.payment.findFirstOrThrow();
    expect(payment.clientId).toBe('cli_e2e');
    expect(await admin.invoicePaymentLink.count({ where: { status: 'COMPLETED' } })).toBe(0);
  });

  it('stores unknown events IGNORED and refunds PARKED without touching a payment', async () => {
    const other = eventBody('evt_other', 'customer.created', { id: 'cus_1', object: 'customer' });
    expect((await deliver(other)).body.outcome).toBe('ignored');
    const refund = eventBody('evt_refund', 'charge.refunded', {
      id: 'ch_1',
      object: 'charge',
      payment_intent: 'pi_link',
      metadata: {},
    });
    expect((await deliver(refund)).body.outcome).toBe('parked');
    expect(await admin.payment.count()).toBe(0);
    const rows = await admin.integrationEvent.findMany({ orderBy: { eventId: 'asc' } });
    expect(rows.map((r) => [r.eventId, r.outcome, r.reasonCode])).toEqual([
      ['evt_other', 'IGNORED', null],
      ['evt_refund', 'PARKED', 'REFUND'],
    ]);
  });

  it('parks NO_MAPPING when the Owner has not set the Stripe target', async () => {
    await admin.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    expect((await deliver(linkPayment())).body.outcome).toBe('parked');
    expect(await admin.payment.count()).toBe(0);
    expect((await admin.integrationEvent.findFirstOrThrow()).reasonCode).toBe('NO_MAPPING');
  });

  it('parks a payment Stripe cannot find instead of failing the delivery', async () => {
    const body = eventBody('evt_gone', 'payment_intent.succeeded', {
      id: 'pi_gone',
      object: 'payment_intent',
      metadata: {},
    });
    expect((await deliver(body)).body.outcome).toBe('parked');
    expect((await admin.integrationEvent.findFirstOrThrow()).reasonCode).toBe('PAYMENT_NOT_FOUND');
  });

  it('lets two simultaneous deliveries of one event write exactly one payment', async () => {
    const body = linkPayment();
    const results = await Promise.all([deliver(body), deliver(body)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.outcome).sort()).toEqual(['duplicate', 'processed']);
    expect(await admin.payment.count()).toBe(1);
    expect(await admin.integrationEvent.count()).toBe(1);
  });
});
