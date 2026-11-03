import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingModule } from '../../../src/modules/finance/billing.module';
import { SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { GenerateRecurringInstallments } from '../../../src/modules/finance/application/use-cases/billing/generate-recurring-installments.use-case';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { seedClient, seedProject } from '../../commercial/concurrency/world';
import { createTestPrisma } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
const CLERK_PREFIX = 'user_e2e_billing_';
/** 2026-10-09 in Caracas. */
const TODAY = '2026-10-09T15:00:00.000Z';

describe('billing (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  const clock = new FixedClock(TODAY);
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [BillingModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: CLOCK, useValue: clock },
      ],
    });
  });

  afterAll(async () => {
    await clean();
    await app.close();
    await admin.$disconnect();
  });

  async function clean() {
    await admin.invoice.deleteMany({ where: { invoiceNumber: { startsWith: 'e2e-bil' } } });
    await admin.billingInstallment.deleteMany();
    await admin.recurringCharge.deleteMany();
    await admin.billingPlan.deleteMany();
    await admin.activityLog.deleteMany({
      where: { entityType: { in: ['BILLING_PLAN', 'INSTALLMENT', 'RECURRING_CHARGE'] } },
    });
    await admin.exchangeRate.deleteMany();
    await admin.projectClient.deleteMany({ where: { projectId: 'pry_e2e_bil' } });
    await admin.projectMetrics.deleteMany({ where: { projectId: 'pry_e2e_bil' } });
    await admin.project.deleteMany({ where: { id: 'pry_e2e_bil' } });
    await admin.client.deleteMany({ where: { id: 'cli_e2e_bil' } });
    await admin.user.deleteMany({ where: { clerkId: { startsWith: CLERK_PREFIX } } });
  }

  beforeEach(async () => {
    await clean();
    clock.set(TODAY);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `${CLERK_PREFIX}${role.toLowerCase()}`,
          email: `billing-${role.toLowerCase()}@example.test`,
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
    await seedClient(admin, 'cli_e2e_bil');
    await seedProject(admin, 'pry_e2e_bil', ['cli_e2e_bil']);
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());
  const plan = (over: Record<string, unknown> = {}) => ({
    model: 'PRECIO_FIJO',
    currency: 'USD',
    contractAmount: '10000',
    ...over,
  });
  const putPlan = (over: Record<string, unknown> = {}) =>
    http()
      .put(`${BASE}/projects/pry_e2e_bil/billing-plan`)
      .set('Authorization', as('OWNER'))
      .send(plan(over));
  const installment = (over: Record<string, unknown> = {}) => ({
    kind: 'CUOTA',
    label: 'Cuota',
    amount: '100',
    currency: 'USD',
    ...over,
  });
  const amountsOf = (body: { installments: { amount: string; cancelledAt: string | null }[] }) =>
    body.installments.filter((item) => item.cancelledAt === null).map((item) => item.amount);

  /** A live invoice with a line on the installment, as the invoices package will write it. */
  async function billInstallment(installmentId: string) {
    await admin.invoice.create({
      data: {
        code: 'FAC-E2E-BIL',
        clientId: 'cli_e2e_bil',
        invoiceNumber: 'e2e-bil-1',
        issueDate: new Date('2026-10-01'),
        dueDate: new Date('2026-11-01'),
        currency: 'USD',
        usdRate: 1,
        subtotal: 4000,
        taxBase: 0,
        ivaAmount: 0,
        total: 4000,
        receivable: 4000,
        totalUsd: 4000,
        receivableUsd: 4000,
        balance: 4000,
        lines: {
          create: [
            {
              projectId: 'pry_e2e_bil',
              installmentId,
              description: 'x',
              unitPrice: 4000,
              amount: 4000,
              netAmount: 4000,
              ivaRate: 0,
            },
          ],
        },
      },
    });
  }

  describe('access', () => {
    it('answers UNAUTHENTICATED on every route without a session', async () => {
      for (const call of [
        () => http().get(`${BASE}/projects/pry_e2e_bil/billing`),
        () => http().put(`${BASE}/projects/pry_e2e_bil/billing-plan`).send(plan()),
        () => http().post(`${BASE}/projects/pry_e2e_bil/billing-plan/template`).send({}),
        () => http().post(`${BASE}/projects/pry_e2e_bil/installments`).send({}),
        () => http().patch(`${BASE}/installments/x`).send({}),
        () => http().post(`${BASE}/installments/x/cancel`),
        () => http().post(`${BASE}/projects/pry_e2e_bil/recurring-charges`).send({}),
        () => http().patch(`${BASE}/recurring-charges/x`).send({}),
        () => http().post(`${BASE}/recurring-charges/x/status`).send({}),
        () => http().post(`${BASE}/recurring-charges/x/generate-missing-periods`).send({}),
      ]) {
        const res = await call().expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('gives Member and Viewer FORBIDDEN on every route and writes nothing', async () => {
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        const auth = as(role);
        for (const call of [
          () => http().get(`${BASE}/projects/pry_e2e_bil/billing`).set('Authorization', auth),
          () =>
            http()
              .put(`${BASE}/projects/pry_e2e_bil/billing-plan`)
              .set('Authorization', auth)
              .send(plan()),
          () =>
            http()
              .post(`${BASE}/projects/pry_e2e_bil/billing-plan/template`)
              .set('Authorization', auth)
              .send({ template: 'FULL_UPFRONT' }),
          () =>
            http()
              .post(`${BASE}/projects/pry_e2e_bil/installments`)
              .set('Authorization', auth)
              .send(installment()),
          () =>
            http().patch(`${BASE}/installments/x`).set('Authorization', auth).send({ label: 'x' }),
          () => http().post(`${BASE}/installments/x/cancel`).set('Authorization', auth),
          () =>
            http()
              .post(`${BASE}/projects/pry_e2e_bil/recurring-charges`)
              .set('Authorization', auth)
              .send({
                label: 'x',
                amount: '10',
                currency: 'USD',
                frequency: 'MENSUAL',
                startDate: '2026-11-01',
                billingDay: 5,
              }),
          () => http().patch(`${BASE}/recurring-charges/x`).set('Authorization', auth).send({}),
          () =>
            http()
              .post(`${BASE}/recurring-charges/x/status`)
              .set('Authorization', auth)
              .send({ status: 'PAUSADO' }),
          () =>
            http()
              .post(`${BASE}/recurring-charges/x/generate-missing-periods`)
              .set('Authorization', auth)
              .send({}),
        ]) {
          const res = await call().expect(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
      expect(await admin.billingPlan.count()).toBe(0);
      expect(await admin.activityLog.count({ where: { entityType: 'BILLING_PLAN' } })).toBe(0);
    });

    it('lets Admin use the routes too', async () => {
      await http()
        .put(`${BASE}/projects/pry_e2e_bil/billing-plan`)
        .set('Authorization', as('ADMIN'))
        .send(plan())
        .expect(200);
    });

    it('answers NOT_FOUND for an unknown project and a malformed id is VALIDATION', async () => {
      const res = await http()
        .get(`${BASE}/projects/pry_missing/billing`)
        .set('Authorization', as('OWNER'))
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      await http()
        .get(`${BASE}/projects/bad%20id/billing`)
        .set('Authorization', as('OWNER'))
        .expect(422);
    });
  });

  describe('HU-09: plan and installments', () => {
    it('CA1: 40/30/30 on 10 000 USD generates 4 000, 3 000 and 3 000', async () => {
      const saved = await putPlan().expect(200);
      expect(saved.body.plan).toMatchObject({
        contractedUsd: '10000.00',
        usdRate: '1',
        scheduleConsistent: false,
      });
      const res = await http()
        .post(`${BASE}/projects/pry_e2e_bil/billing-plan/template`)
        .set('Authorization', as('OWNER'))
        .send({ template: 'SPLIT_40_30_30' })
        .expect(200);
      expect(amountsOf(res.body)).toEqual(['4000.00', '3000.00', '3000.00']);
      expect(res.body.installments.map((item: { percentage: string }) => item.percentage)).toEqual([
        '40',
        '30',
        '30',
      ]);
      expect(res.body.plan).toMatchObject({
        scheduleConsistent: true,
        scheduleDifference: null,
        installmentsTotal: '10000.00',
      });

      const page = await http()
        .get(`${BASE}/projects/pry_e2e_bil/billing`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(page.body).toEqual(res.body);
      expect(
        await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_e2e_bil' } }),
      ).toMatchObject({
        toInvoiceUsd: expect.anything(),
      });
    });

    it('CA2: a persistent mismatch is reported and never blocks', async () => {
      await putPlan().expect(200);
      for (const [kind, amount] of [
        ['ANTICIPO', '4000'],
        ['HITO', '3000'],
      ]) {
        await http()
          .post(`${BASE}/projects/pry_e2e_bil/installments`)
          .set('Authorization', as('OWNER'))
          .send(installment({ kind, label: kind, amount }))
          .expect(200);
      }
      const page = await http()
        .get(`${BASE}/projects/pry_e2e_bil/billing`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(page.body.plan).toMatchObject({
        scheduleConsistent: false,
        scheduleDifference: '-3000.00',
        installmentsTotal: '7000.00',
      });
    });

    it('CA3: a billed installment answers INTEGRITY_LOCK on amount and cancel; the label still changes', async () => {
      await putPlan().expect(200);
      const created = await http()
        .post(`${BASE}/projects/pry_e2e_bil/installments`)
        .set('Authorization', as('OWNER'))
        .send(installment({ kind: 'ANTICIPO', label: 'Anticipo', amount: '4000' }))
        .expect(200);
      const id = created.body.installments[0].id as string;
      await billInstallment(id);

      const edit = await http()
        .patch(`${BASE}/installments/${id}`)
        .set('Authorization', as('OWNER'))
        .send({ amount: '4500' })
        .expect(409);
      expect(edit.body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'billing.errors.installmentBilled',
      });
      const cancel = await http()
        .post(`${BASE}/installments/${id}/cancel`)
        .set('Authorization', as('OWNER'))
        .expect(409);
      expect(cancel.body.error.code).toBe('INTEGRITY_LOCK');
      const label = await http()
        .patch(`${BASE}/installments/${id}`)
        .set('Authorization', as('OWNER'))
        .send({ label: 'Firmado' })
        .expect(200);
      expect(label.body.installments[0]).toMatchObject({
        label: 'Firmado',
        amount: '4000.00',
        locked: true,
        invoicedAmount: '4000.00',
      });
      const row = await admin.billingInstallment.findUniqueOrThrow({ where: { id } });
      expect(row.amount.toFixed(2)).toBe('4000.00');
    });

    it('answers VALIDATION with field errors, 422', async () => {
      await putPlan().expect(200);
      const zero = await http()
        .post(`${BASE}/projects/pry_e2e_bil/installments`)
        .set('Authorization', as('OWNER'))
        .send(installment({ kind: 'AJUSTE', amount: '0' }))
        .expect(422);
      expect(zero.body.error.fieldErrors.amount).toEqual(['billing.validation.adjustmentNonZero']);
      const noPlan = await http()
        .put(`${BASE}/projects/pry_e2e_bil/billing-plan`)
        .set('Authorization', as('OWNER'))
        .send(plan({ currency: 'EUR' }))
        .expect(422);
      expect(noPlan.body.error.fieldErrors.currency).toEqual(['billing.errors.rateMissing']);
      await http()
        .patch(`${BASE}/installments/x`)
        .set('Authorization', as('OWNER'))
        .send({})
        .expect(404);
    });

    it('the plan takes the rate of the day in USD terms and the page returns it', async () => {
      await admin.exchangeRate.create({
        data: { date: new Date('2026-10-09'), currency: 'EUR', usdRate: '0.9', source: 'BCV' },
      });
      const res = await putPlan({ currency: 'EUR', contractAmount: '1000' }).expect(200);
      expect(res.body.plan).toMatchObject({ contractedUsd: '1111.11', usdRate: '0.9' });
      expect(res.body.plan.createdAt).toEqual(expect.any(String));
    });
  });

  describe('HU-10: recurring charges', () => {
    const charge = (over: Record<string, unknown> = {}) => ({
      label: 'Soporte',
      amount: '100',
      currency: 'USD',
      frequency: 'MENSUAL',
      startDate: '2026-11-01',
      billingDay: 5,
      leadDays: 7,
      ...over,
    });

    async function createCharge(over: Record<string, unknown> = {}) {
      await putPlan().expect(200);
      const res = await http()
        .post(`${BASE}/projects/pry_e2e_bil/recurring-charges`)
        .set('Authorization', as('OWNER'))
        .send(charge(over))
        .expect(200);
      return res.body.recurringCharges[0].id as string;
    }

    const periods = async (chargeId: string) =>
      (
        await admin.billingInstallment.findMany({
          where: { recurringChargeId: chargeId },
          orderBy: { periodStart: 'asc' },
        })
      ).map((row) => row.periodStart?.toISOString().slice(0, 10));

    it('CA1: the step creates the period on the 29th with the 5th as its date, once', async () => {
      const id = await createCharge();
      const step = app.get(GenerateRecurringInstallments, { strict: false });
      clock.set('2026-10-28T15:00:00.000Z');
      await step.execute(SYSTEM_ACTOR);
      expect(await periods(id)).toEqual([]);

      clock.set('2026-10-29T15:00:00.000Z');
      expect(await step.execute(SYSTEM_ACTOR)).toEqual({
        created: 1,
        periodStarts: ['2026-11-05'],
        skippedIds: [],
      });
      // CA2: running it again the same day creates no duplicate.
      expect(await step.execute(SYSTEM_ACTOR)).toEqual({
        created: 0,
        periodStarts: [],
        skippedIds: [],
      });
      expect(await periods(id)).toEqual(['2026-11-05']);
      const row = await admin.billingInstallment.findFirstOrThrow({
        where: { recurringChargeId: id },
      });
      expect(row).toMatchObject({
        kind: 'RECURRENTE',
        status: 'PENDIENTE',
        label: 'Soporte · 2026-11-05',
      });
      expect(row.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-05');
      expect(
        await admin.activityLog.count({ where: { action: 'SYSTEM_JOB', actorType: 'SYSTEM' } }),
      ).toBe(1);
    });

    it('CA3: a paused charge generates nothing; the missing periods are created on request', async () => {
      const id = await createCharge();
      await http()
        .post(`${BASE}/recurring-charges/${id}/status`)
        .set('Authorization', as('OWNER'))
        .send({ status: 'PAUSADO' })
        .expect(200);
      clock.set('2026-12-31T15:00:00.000Z');
      await app.get(GenerateRecurringInstallments, { strict: false }).execute(SYSTEM_ACTOR);
      expect(await periods(id)).toEqual([]);

      const res = await http()
        .post(`${BASE}/recurring-charges/${id}/generate-missing-periods`)
        .set('Authorization', as('OWNER'))
        .send({ upTo: '2026-12-31' })
        .expect(200);
      expect(res.body).toEqual({
        created: 3,
        periodStarts: ['2026-11-05', '2026-12-05', '2027-01-05'],
      });
      const resumed = await http()
        .post(`${BASE}/recurring-charges/${id}/status`)
        .set('Authorization', as('OWNER'))
        .send({ status: 'ACTIVO' })
        .expect(200);
      expect(resumed.body.recurringCharges[0]).toMatchObject({
        status: 'ACTIVO',
        resumedOn: '2026-12-31',
      });
    });

    it('a finished charge is final (CONFLICT) and the monthly amount of a quarterly one is a third', async () => {
      const id = await createCharge({ frequency: 'TRIMESTRAL', amount: '300' });
      const page = await http()
        .get(`${BASE}/projects/pry_e2e_bil/billing`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(page.body.recurringCharges[0].monthlyAmount).toBe('100.00');
      await http()
        .post(`${BASE}/recurring-charges/${id}/status`)
        .set('Authorization', as('OWNER'))
        .send({ status: 'FINALIZADO' })
        .expect(200);
      const res = await http()
        .post(`${BASE}/recurring-charges/${id}/status`)
        .set('Authorization', as('OWNER'))
        .send({ status: 'ACTIVO' })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'billing.errors.chargeFinished',
      });
    });

    it('edits a charge, feeds ProjectMetrics and refuses a day above 28', async () => {
      const id = await createCharge();
      expect(
        await admin.projectMetrics.findUniqueOrThrow({ where: { projectId: 'pry_e2e_bil' } }),
      ).toMatchObject({});
      const edited = await http()
        .patch(`${BASE}/recurring-charges/${id}`)
        .set('Authorization', as('OWNER'))
        .send(charge({ amount: '250.00', billingDay: 10 }))
        .expect(200);
      expect(edited.body.recurringCharges[0]).toMatchObject({ amount: '250.00', billingDay: 10 });
      const metrics = await admin.projectMetrics.findUniqueOrThrow({
        where: { projectId: 'pry_e2e_bil' },
      });
      expect(metrics.monthlyRecurringUsd.toFixed(2)).toBe('250.00');
      const bad = await http()
        .patch(`${BASE}/recurring-charges/${id}`)
        .set('Authorization', as('OWNER'))
        .send(charge({ billingDay: 29 }))
        .expect(422);
      expect(bad.body.error.fieldErrors.billingDay).toEqual(['billing.validation.billingDayRange']);
    });
  });
});
