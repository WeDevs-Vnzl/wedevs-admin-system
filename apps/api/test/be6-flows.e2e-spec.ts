import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MarkExpiredDocuments } from '../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { MarkExpiredShareLinks } from '../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { GenerateRecurringInstallments } from '../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { GenerateRecurringExpenses } from '../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { MarkOverdueInvoices } from '../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { MatrixAuthorization } from '../src/modules/identity/application/matrix-authorization';
import { PAYMENT_PROVIDER } from '../src/modules/integrations/application/ports/payment-provider.port';
import { DeactivatePaymentLinksBeyondBalance } from '../src/modules/integrations/application/use-cases/payment-links/deactivate-payment-links-beyond-balance.use-case';
import { createStripePaymentProvider } from '../src/modules/integrations/infrastructure/stripe/stripe-payment-provider';
import { DailyMaintenance } from '../src/modules/jobs/application/daily-maintenance';
import { JobRunner } from '../src/modules/jobs/application/job-runner';
import type { CurrentUser } from '../src/shared/application/current-user';
import { ACTIVITY_LOG, AUTHORIZATION, UNIT_OF_WORK } from '../src/shared/application/ports/tokens';
import type { ActivityLogPort } from '../src/shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../src/shared/application/ports/unit-of-work.port';
import type { UserRole } from '../src/shared/domain/enums';
import type { DbClient } from '../src/shared/infrastructure/prisma/transaction-host';
import { seedAccount, seedClient, seedInvoice } from './finance/read-models/world';
import {
  ScriptedStripeFetch,
  scriptedStripeApi,
  signPayload,
  stripeError,
  testApiKey,
  testWebhookSecret,
} from './integrations/stripe/scripted-stripe';
import { connect } from './mcp/harness';
import { createTestPrisma, truncateBusinessTables } from './support/db';
import { FakeAuthenticator } from './support/fakes/fake-authenticator';
import { createTestApp } from './support/test-app';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const V1 = '/api/v1';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const apiKey = testApiKey();
const webhookSecret = testWebhookSecret();
const REQ = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const created = Math.floor(Date.now() / 1000) - 3600;

/**
 * BE-6 flow over the full `AppModule` (package 4.1): personal access tokens, MCP over Streamable HTTP, Stripe
 * payment links and the signed webhook, finance's confirm and allocate routes, and the daily link step. The real
 * `MatrixAuthorization` and route guard, a fake identity provider for the Clerk routes, the SDK client in process
 * and a scripted Stripe `fetch`: no network, no external MCP client.
 */
describe('BE-6 flows (full app)', () => {
  const prisma = createTestPrisma();
  const seedDb = prisma as unknown as DbClient;
  const authenticator = new FakeAuthenticator();
  const sessions = {} as Record<UserRole, string>;
  const users = {} as Record<UserRole, CurrentUser>;
  const intents = new Map<string, Body>();
  let app: NestExpressApplication;
  let mcpUrl: URL;

  beforeAll(async () => {
    process.env.FEATURE_STRIPE = 'true';
    process.env.STRIPE_SECRET_KEY = apiKey;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const script = new ScriptedStripeFetch();
    script.on((r) => {
      if (r.method !== 'GET' || !r.url.pathname.startsWith('/v1/payment_intents/'))
        return undefined;
      const intent = intents.get(r.url.pathname.split('/').pop() ?? '');
      return intent
        ? { status: 200, body: intent }
        : stripeError(404, 'invalid_request_error', 'resource_missing');
    });
    scriptedStripeApi(script);
    app = await createTestApp({
      authenticator,
      probes: false,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        {
          token: PAYMENT_PROVIDER,
          useValue: createStripePaymentProvider({
            apiKey,
            webhookSecret,
            returnUrl: 'https://app.example.test',
            httpClient: script.httpClient(),
          }),
        },
      ],
    });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    mcpUrl = new URL(`http://127.0.0.1:${port}${V1}/mcp`);

    await truncateBusinessTables(prisma);
    await prisma.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `user_be6_${role.toLowerCase()}`,
          email: `be6-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      users[role] = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      sessions[role] = authenticator.issue(users[role]);
    }
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { key: 'integrations.mapping' } });
    await truncateBusinessTables(prisma);
    await app.close();
    await prisma.$disconnect();
    delete process.env.FEATURE_STRIPE;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  const call = (method: 'get' | 'post' | 'put', role: UserRole, path: string) =>
    request(app.getHttpServer())
      [method](`${V1}${path}`)
      .set('Authorization', `Bearer ${sessions[role]}`);
  const get = (path: string, role: UserRole = 'OWNER') => call('get', role, path);
  const post = (path: string, body: object = {}, role: UserRole = 'OWNER') =>
    call('post', role, path).send(body);
  const issueToken = async (role: UserRole): Promise<{ id: string; secret: string }> =>
    (await post('/me/api-tokens', { name: `flow-${role}` }, role).expect(201)).body;
  const deliver = (body: string) =>
    request(app.getHttpServer())
      .post(`${V1}/webhooks/stripe`)
      .set('content-type', 'application/json')
      .set('stripe-signature', signPayload(body, webhookSecret))
      .send(body);

  it('token -> MCP -> two links -> signed event -> duplicate -> confirm and allocate -> manual payment -> daily step -> Member refused -> revoke', async () => {
    await seedClient(seedDb, 'cli_be6');
    await seedAccount(seedDb, 'acc_be6', 'USD');
    await seedInvoice(seedDb, {
      id: 'inv_be6',
      clientId: 'cli_be6',
      lines: [{ id: 'l1', projectId: null, unitPrice: '100.00', ivaRate: null }],
    });
    const method = await prisma.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } });
    await call('put', 'OWNER', '/settings/integrations')
      .send({ stripe: { accountId: 'acc_be6', paymentMethodId: method.id } })
      .expect(200);

    // 1. The Owner issues a token; the MCP tool answers the same body as the HTTP route.
    const ownerToken = await issueToken('OWNER');
    expect(ownerToken.secret).toMatch(/^wdc_pat_/);
    const owner = await connect({ mcpUrl }, ownerToken.secret);
    const viaMcp = await owner.call('list_open_invoices', { clientId: 'cli_be6' });
    const viaHttp = await get('/clients/cli_be6/open-invoices').expect(200);
    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.body).toEqual(viaHttp.body);
    expect(viaHttp.body).toHaveLength(1);

    // 2. Two links of 40 and 60 on a 100 USD invoice; nothing is left to link.
    const link40 = (
      await post('/invoices/inv_be6/payment-links', { amount: '40.00', requestId: REQ(1) }).expect(
        201,
      )
    ).body as Body;
    const link60 = (
      await post('/invoices/inv_be6/payment-links', { amount: '60.00', requestId: REQ(2) }).expect(
        201,
      )
    ).body as Body;
    expect(await get('/invoices/inv_be6/payment-links').then((r) => r.body.capacity)).toBe('0.00');

    // 3. A signed Stripe event for the 40 link records a pending payment and completes the link.
    intents.set('pi_40', {
      id: 'pi_40',
      object: 'payment_intent',
      amount: 4000,
      amount_received: 4000,
      currency: 'usd',
      status: 'succeeded',
      created,
      metadata: { invoiceId: 'inv_be6', linkId: link40.id },
      latest_charge: null,
    });
    const event = JSON.stringify({
      id: 'evt_be6_40',
      object: 'event',
      type: 'payment_intent.succeeded',
      created,
      data: {
        object: {
          id: 'pi_40',
          object: 'payment_intent',
          metadata: { invoiceId: 'inv_be6', linkId: link40.id },
        },
      },
    });
    const first = await deliver(event);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true, outcome: 'processed' });
    const payments = await prisma.payment.findMany({ where: { externalId: 'pi_40' } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      status: 'PENDIENTE_VERIFICACION',
      externalProvider: 'STRIPE',
    });
    expect(payments[0]?.amount.toFixed(2)).toBe('40.00');
    expect(
      await prisma.invoicePaymentLink.findUniqueOrThrow({ where: { id: link40.id } }),
    ).toMatchObject({ status: 'COMPLETED', paymentId: payments[0]?.id });
    // Q-BE6-13 (DT-199): the completed link keeps its 40 reserved until the payment is allocated or voided.
    const reserved = await get('/invoices/inv_be6/payment-links');
    expect(reserved.body.capacity).toBe('0.00');
    expect((await get('/invoices/inv_be6').expect(200)).body.totals.balance).toBe('100.00');

    // 4. The same event again is ignored.
    const again = await deliver(event);
    expect(again.body).toEqual({ received: true, outcome: 'duplicate' });
    expect(await prisma.payment.count({ where: { externalId: 'pi_40' } })).toBe(1);

    // 5. A partner confirms and allocates the 40 through the existing routes.
    const paymentId = payments[0]?.id ?? '';
    await post(`/payments/${paymentId}/status`, { status: 'CONFIRMADO' }, 'ADMIN').expect(200);
    await post(
      `/payments/${paymentId}/allocations`,
      { invoiceId: 'inv_be6', amountPaymentCurrency: '40.00', amountInvoiceCurrency: '40.00' },
      'ADMIN',
    ).expect(201);
    expect((await get('/invoices/inv_be6').expect(200)).body).toMatchObject({
      status: 'PARCIAL',
      totals: { paidAmount: '40.00', balance: '60.00' },
    });
    expect(
      (await prisma.invoicePaymentLink.findUniqueOrThrow({ where: { id: link40.id } })).status,
    ).toBe('SETTLED');

    // 6. A manual 60 payment settles the invoice.
    await post('/payments', {
      clientId: 'cli_be6',
      date: '2026-11-02',
      accountId: 'acc_be6',
      methodId: method.id,
      currency: 'USD',
      amount: '60.00',
      usdRate: '1',
      reference: 'ZL-60',
      allocations: [
        { invoiceId: 'inv_be6', amountPaymentCurrency: '60.00', amountInvoiceCurrency: '60.00' },
      ],
    }).expect(201);
    expect((await get('/invoices/inv_be6').expect(200)).body.status).toBe('PAGADA');

    // 7. The daily step deactivates the 60 link: the invoice is no longer open.
    const runner = new JobRunner(
      app.get<UnitOfWorkPort>(UNIT_OF_WORK),
      app.get<ActivityLogPort>(ACTIVITY_LOG),
      { stepFailed: ({ step, error }) => expect.fail(`${step}: ${String(error)}`) },
    );
    const pick = <T>(type: new (...args: never[]) => T): T => app.get(type, { strict: false });
    const daily = await new DailyMaintenance(runner, {
      markOverdueInvoices: pick(MarkOverdueInvoices),
      markExpiredDocuments: pick(MarkExpiredDocuments),
      generateRecurringInstallments: pick(GenerateRecurringInstallments),
      generateRecurringExpenses: pick(GenerateRecurringExpenses),
      markExpiredShareLinks: pick(MarkExpiredShareLinks),
      deactivatePaymentLinks: pick(DeactivatePaymentLinksBeyondBalance),
    }).execute();
    expect(daily.steps.at(-1)).toMatchObject({
      name: 'deactivate-payment-links',
      status: 'ok',
      counts: { deactivated: 1 },
    });
    expect(
      await prisma.invoicePaymentLink.findUniqueOrThrow({ where: { id: link60.id } }),
    ).toMatchObject({ status: 'DEACTIVATED' });

    // 8. A Member's token cannot call create_client: refused, nothing written.
    const clientsBefore = await prisma.client.count();
    const memberToken = await issueToken('MEMBER');
    const member = await connect({ mcpUrl }, memberToken.secret);
    const refused = await member.call('create_client', {
      kind: 'EMPRESA',
      tradeName: 'Nube Austral',
      legalName: 'Nube Austral C.A.',
      taxId: 'J-40111222-3',
      country: 'VE',
      address: 'Av. Principal, Caracas',
      phone: '+584121234567',
    });
    expect(refused.isError).toBe(true);
    expect(refused.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.client.count()).toBe(clientsBefore);
    await member.close().catch(() => undefined);

    // 9. The Owner revokes the token: the next MCP call is a 401.
    await post(`/me/api-tokens/${ownerToken.id}/revoke`).expect(200);
    const revoked = await request(app.getHttpServer())
      .post(`${V1}/mcp`)
      .set('Authorization', `Bearer ${ownerToken.secret}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('UNAUTHENTICATED');
    await owner.close().catch(() => undefined);
  });
});
