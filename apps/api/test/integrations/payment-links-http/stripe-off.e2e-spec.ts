import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { PaymentLinksModule } from '../../../src/modules/integrations/payment-links.module';
import { StripeModule } from '../../../src/modules/integrations/stripe.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** Stripe off two ways: no keys (DT-193), or complete keys with `FEATURE_STRIPE` not `true` (DT-227). */
const OFF_ENVS = [
  ['unconfigured', {}],
  ['keys set, FEATURE_STRIPE unset', { STRIPE_SECRET_KEY: 'sk_test_off', STRIPE_WEBHOOK_SECRET: 'whsec_off' }],
  [
    'keys set, FEATURE_STRIPE=false',
    { STRIPE_SECRET_KEY: 'sk_test_off', STRIPE_WEBHOOK_SECRET: 'whsec_off', FEATURE_STRIPE: 'false' },
  ],
] as const;

function clearStripeEnv(): void {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.FEATURE_STRIPE;
}

describe.each(OFF_ENVS)('Stripe off (e2e), %s: choice 3, DT-193, DT-227', (_label, env) => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    clearStripeEnv();
    Object.assign(process.env, env);
    const authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [StripeModule, PaymentLinksModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
    await truncateBusinessTables(admin);
    const row = await admin.user.create({
      data: { clerkId: 'user_e2e_off', email: 'off@example.test', name: 'Owner', role: 'OWNER' },
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

  afterAll(async () => {
    clearStripeEnv();
    await truncateBusinessTables(admin);
    await app.close();
  });

  it('answers 404 NOT_FOUND on the webhook, before any signature check', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('content-type', 'application/json')
      .send('{}');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 NOT_FOUND on the three link routes', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const http = () => request(app.getHttpServer());
    const body = { amount: '10.00', requestId: '11111111-1111-4111-8111-111111111111' };
    for (const res of [
      await http().get('/api/v1/invoices/inv_1/payment-links').set(auth),
      await http().post('/api/v1/invoices/inv_1/payment-links').set(auth).send(body),
      await http().post('/api/v1/invoices/inv_1/payment-links/lnk_1/deactivate').set(auth),
    ]) {
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

afterAll(async () => {
  await admin.$disconnect();
});
