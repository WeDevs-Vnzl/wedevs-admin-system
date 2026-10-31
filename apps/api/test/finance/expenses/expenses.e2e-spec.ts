import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import type { FileAccessRegistry } from '../../../src/modules/platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../../../src/modules/platform/application/ports/file-access.port';
import { TAGGABLE_TARGET_REGISTRY } from '../../../src/modules/settings/application/ports/taggable-target.port';
import type { TaggableTargetRegistry } from '../../../src/modules/settings/application/taggable-target.registry';
import {
  GENERATION_ACTOR,
  GenerateRecurringExpenses,
} from '../../../src/modules/finance/application/use-cases/expenses/generate-recurring-expenses.use-case';
import { ExpensesModule } from '../../../src/modules/finance/expenses.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
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

/** `YYYY-MM-01` of the month `back` months before the current one (UTC). */
function firstOfMonth(back: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    .toISOString()
    .slice(0, 10);
}

describe('expenses (e2e): HU-17', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let categoryId = '';
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [ExpensesModule],
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
    categoryId = (await admin.expenseCategory.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_exp_${role.toLowerCase()}`,
          email: `exp-${role.toLowerCase()}@example.test`,
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
    await admin.client.create({
      data: {
        id: 'cli_e2e',
        code: 'CLI-0001',
        kind: 'EMPRESA',
        tradeName: 'Kairos',
        legalName: 'Kairos C.A.',
        taxId: 'J-1',
        country: 'VE',
        address: 'Av. Principal',
        phone: '+584121234567',
      },
    });
    await admin.project.create({
      data: {
        id: 'pry_e2e',
        code: 'PRY-0001',
        name: 'Kairos Web',
        summary: 'Resumen',
        clients: { create: [{ clientId: 'cli_e2e' }] },
      },
    });
    await admin.account.create({
      data: {
        id: 'acc_usd',
        name: 'Zelle',
        type: 'BANCO_INTERNACIONAL',
        currency: 'USD',
        openingBalance: '1200.00',
        balance: '1200.00',
        openingDate: new Date('2026-01-01'),
      },
    });
    await admin.account.create({
      data: {
        id: 'acc_ves',
        name: 'Caja VES',
        type: 'EFECTIVO',
        currency: 'VES',
        openingBalance: '10000.00',
        balance: '10000.00',
        openingDate: new Date('2026-01-01'),
      },
    });
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());
  const body = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-05',
    description: 'Hosting (e2e)',
    categoryId,
    currency: 'USD',
    amount: '50.00',
    usdRate: '1',
    status: 'PENDIENTE',
    ...over,
  });
  const create = async (over: Record<string, unknown> = {}) =>
    (
      await http()
        .post(`${BASE}/expenses`)
        .set('Authorization', as('OWNER'))
        .send(body(over))
        .expect(201)
    ).body;
  const balanceOf = async (id: string) =>
    (await admin.account.findUniqueOrThrow({ where: { id } })).balance.toFixed(2);

  describe('access', () => {
    it('answers UNAUTHENTICATED without a session and FORBIDDEN to Member and Viewer on every route', async () => {
      const routes = [
        () => http().get(`${BASE}/expenses`),
        () => http().post(`${BASE}/expenses`).send(body()),
        () => http().get(`${BASE}/expenses/x`),
        () => http().patch(`${BASE}/expenses/x`).send(body()),
        () => http().post(`${BASE}/expenses/x/pay`).send({}),
        () => http().post(`${BASE}/expenses/x/void`).send({}),
        () => http().get(`${BASE}/recurring-expenses`),
        () => http().post(`${BASE}/recurring-expenses`).send({}),
        () => http().get(`${BASE}/recurring-expenses/x`),
        () => http().patch(`${BASE}/recurring-expenses/x`).send({}),
        () => http().post(`${BASE}/recurring-expenses/x/status`).send({ status: 'PAUSADO' }),
      ];
      for (const call of routes) {
        expect((await call().expect(401)).body.error.code).toBe('UNAUTHENTICATED');
      }
      for (const role of ['MEMBER', 'VIEWER'] as const) {
        for (const call of routes) {
          const res = await call().set('Authorization', as(role)).expect(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
        }
      }
      expect(await admin.expense.count()).toBe(0);
    });

    it('lets Admin use the routes too', async () => {
      await http().get(`${BASE}/expenses`).set('Authorization', as('ADMIN')).expect(200);
      await http().get(`${BASE}/recurring-expenses`).set('Authorization', as('ADMIN')).expect(200);
    });
  });

  describe('create, pay and void (CA2, CA3)', () => {
    it('creates a pending expense with the next GAS code and a search entry', async () => {
      const created = await create();

      expect(created).toMatchObject({
        code: 'GAS-0001',
        status: 'PENDIENTE',
        amountUsd: '50.00',
        paidAt: null,
        recurring: false,
        category: { id: categoryId },
      });
      const entry = await admin.searchEntry.findFirstOrThrow({
        where: { entityType: 'EXPENSE', entityId: created.id },
      });
      expect(entry.code).toBe('GAS-0001');
      expect(await admin.financeFact.count()).toBe(0);
    });

    it('marking an expense paid debits the account and drops the project margin (CA3)', async () => {
      const created = await create({ projectId: 'pry_e2e' });
      expect(await balanceOf('acc_usd')).toBe('1200.00');

      const paid = await http()
        .post(`${BASE}/expenses/${created.id}/pay`)
        .set('Authorization', as('OWNER'))
        .send({
          accountId: 'acc_usd',
          paidAt: '2026-10-08',
          currency: 'USD',
          amount: '49.00',
          usdRate: '1',
        })
        .expect(200);

      expect(paid.body).toMatchObject({
        status: 'PAGADO',
        amount: '49.00',
        amountUsd: '49.00',
        paidAt: '2026-10-08',
      });
      expect(await balanceOf('acc_usd')).toBe('1151.00');
      const metrics = await admin.projectMetrics.findUniqueOrThrow({
        where: { projectId: 'pry_e2e' },
      });
      expect(metrics.expensesUsd.toFixed(2)).toBe('49.00');
      expect(metrics.marginUsd.toFixed(2)).toBe('-49.00');
      const fact = await admin.financeFact.findFirstOrThrow({ where: { kind: 'EXPENSE_PAID' } });
      expect(fact.amountUsd.toFixed(2)).toBe('49.00');
      expect(fact.projectId).toBe('pry_e2e');

      await http()
        .post(`${BASE}/expenses/${created.id}/pay`)
        .set('Authorization', as('OWNER'))
        .send({
          accountId: 'acc_usd',
          paidAt: '2026-10-08',
          currency: 'USD',
          amount: '49.00',
          usdRate: '1',
        })
        .expect(409);
      expect(await balanceOf('acc_usd')).toBe('1151.00');
    });

    it('voiding a paid expense gives the amount back and restores the margin', async () => {
      const created = await create({
        projectId: 'pry_e2e',
        status: 'PAGADO',
        accountId: 'acc_usd',
      });
      expect(await balanceOf('acc_usd')).toBe('1150.00');

      const voided = await http()
        .post(`${BASE}/expenses/${created.id}/void`)
        .set('Authorization', as('OWNER'))
        .send({ reason: 'Duplicado' })
        .expect(200);

      expect(voided.body.status).toBe('ANULADO');
      expect(await balanceOf('acc_usd')).toBe('1200.00');
      const metrics = await admin.projectMetrics.findUniqueOrThrow({
        where: { projectId: 'pry_e2e' },
      });
      expect(metrics.expensesUsd.toFixed(2)).toBe('0.00');
      expect(await admin.financeFact.count()).toBe(0);
      const log = await admin.activityLog.findFirstOrThrow({
        where: { entityId: created.id, action: 'STATUS_CHANGE' },
      });
      expect(log.metadata).toMatchObject({ reason: 'Duplicado', to: 'ANULADO' });

      const again = await http()
        .post(`${BASE}/expenses/${created.id}/void`)
        .set('Authorization', as('OWNER'))
        .send({})
        .expect(409);
      expect(again.body.error.message).toBe('expenses.errors.voided');
    });

    it('a foreign-currency debit needs the amount debited in the account currency (§9.7)', async () => {
      const created = await create({ currency: 'USD', amount: '10.00' });
      const pay = (extra: Record<string, unknown> = {}) =>
        http()
          .post(`${BASE}/expenses/${created.id}/pay`)
          .set('Authorization', as('OWNER'))
          .send({
            accountId: 'acc_ves',
            paidAt: '2026-10-08',
            currency: 'USD',
            amount: '10.00',
            usdRate: '1',
            ...extra,
          });

      const missing = await pay().expect(422);
      expect(missing.body.error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { accountAmount: ['expenses.validation.accountAmountRequired'] },
      });
      expect(await balanceOf('acc_ves')).toBe('10000.00');

      const paid = await pay({ accountAmount: '7551.60' }).expect(200);
      expect(paid.body).toMatchObject({ accountAmount: '7551.60', amountUsd: '10.00' });
      expect(await balanceOf('acc_ves')).toBe('2448.40');
    });

    it('edits a pending expense and refuses to edit a paid one', async () => {
      const created = await create();
      const edited = await http()
        .patch(`${BASE}/expenses/${created.id}`)
        .set('Authorization', as('OWNER'))
        .send({ ...body({ amount: '75.00' }), status: undefined })
        .expect(200);
      expect(edited.body).toMatchObject({ amount: '75.00', amountUsd: '75.00' });

      await http()
        .post(`${BASE}/expenses/${created.id}/pay`)
        .set('Authorization', as('OWNER'))
        .send({
          accountId: 'acc_usd',
          paidAt: '2026-10-08',
          currency: 'USD',
          amount: '75.00',
          usdRate: '1',
        })
        .expect(200);
      const refused = await http()
        .patch(`${BASE}/expenses/${created.id}`)
        .set('Authorization', as('OWNER'))
        .send({ ...body(), status: undefined })
        .expect(409);
      expect(refused.body.error.message).toBe('expenses.errors.notPending');
    });

    it('never trusts client ids and answers the use case rules, not only the DTO', async () => {
      const unknown = await http()
        .post(`${BASE}/expenses`)
        .set('Authorization', as('OWNER'))
        .send(body({ projectId: 'pry_nope', categoryId: 'ecat_nope' }))
        .expect(422);
      expect(unknown.body.error.fieldErrors).toMatchObject({});

      const noAccount = await http()
        .post(`${BASE}/expenses`)
        .set('Authorization', as('OWNER'))
        .send(body({ status: 'PAGADO' }))
        .expect(422);
      expect(noAccount.body.error.fieldErrors.accountId).toEqual([
        'expenses.validation.accountRequiredForPaid',
      ]);
      await http().get(`${BASE}/expenses/nope`).set('Authorization', as('OWNER')).expect(404);
      expect(await admin.expense.count()).toBe(0);
    });

    it('lists with filters, search and sort', async () => {
      await create({ description: 'Alpha host', date: '2026-10-01', projectId: 'pry_e2e' });
      await create({
        description: 'Beta domain',
        date: '2026-10-02',
        currency: 'VES',
        amount: '755.16',
        usdRate: '755.16',
      });
      const list = (qs: string) =>
        http().get(`${BASE}/expenses?${qs}`).set('Authorization', as('OWNER')).expect(200);

      expect((await list('sort=date:asc')).body.items.map((r: { code: string }) => r.code)).toEqual(
        ['GAS-0001', 'GAS-0002'],
      );
      expect((await list('q=beta')).body.total).toBe(1);
      expect((await list('projectId=pry_e2e')).body.items[0].description).toBe('Alpha host');
      expect((await list('currency=VES')).body.items[0].description).toBe('Beta domain');
      expect((await list('dateFrom=2026-10-02&dateTo=2026-10-02')).body.total).toBe(1);
      expect((await list('status=PAGADO')).body.total).toBe(0);
      await http()
        .get(`${BASE}/expenses?sort=nope:asc`)
        .set('Authorization', as('OWNER'))
        .expect(422);
    });
  });

  describe('recurring expenses (CA1)', () => {
    const schedule = (over: Record<string, unknown> = {}) => ({
      name: 'Hosting mensual (e2e)',
      categoryId,
      currency: 'USD',
      amount: '120.00',
      frequency: 'MENSUAL',
      dayOfPeriod: 1,
      leadDays: 0,
      startDate: firstOfMonth(1),
      ...over,
    });

    it('creates a schedule, generates each due period once and never duplicates', async () => {
      const created = await http()
        .post(`${BASE}/recurring-expenses`)
        .set('Authorization', as('OWNER'))
        .send(schedule())
        .expect(201);
      expect(created.body).toMatchObject({
        status: 'ACTIVO',
        usdRate: '1',
        monthlyAmountUsd: '120.00',
      });

      const generator = app.get(GenerateRecurringExpenses);
      const first = await generator.execute(GENERATION_ACTOR);
      const second = await generator.execute(GENERATION_ACTOR);

      expect(first.created).toBe(2);
      expect(second).toEqual({ created: 0, periodStarts: [] });
      const list = await http()
        .get(`${BASE}/expenses?recurringOnly=true&sort=date:asc`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(list.body.total).toBe(2);
      expect(list.body.items[0]).toMatchObject({
        status: 'PENDIENTE',
        recurring: true,
        recurringExpense: { id: created.body.id },
        amount: '120.00',
      });
      const detail = await http()
        .get(`${BASE}/recurring-expenses/${created.body.id}`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(detail.body.lastGeneratedPeriodStart).toBe(firstOfMonth(0));
      expect(
        await admin.activityLog.count({
          where: { action: 'SYSTEM_JOB', entityType: 'RECURRING_EXPENSE' },
        }),
      ).toBe(1);
    });

    it('pauses, resumes and finishes; a finished schedule is final', async () => {
      const created = (
        await http()
          .post(`${BASE}/recurring-expenses`)
          .set('Authorization', as('OWNER'))
          .send(schedule())
          .expect(201)
      ).body;
      const status = (value: string) =>
        http()
          .post(`${BASE}/recurring-expenses/${created.id}/status`)
          .set('Authorization', as('OWNER'))
          .send({ status: value });

      expect((await status('PAUSADO').expect(200)).body.status).toBe('PAUSADO');
      expect((await status('ACTIVO').expect(200)).body.resumedOn).not.toBeNull();
      expect((await status('FINALIZADO').expect(200)).body.nextDueDate).toBeNull();
      const finished = await status('ACTIVO').expect(409);
      expect(finished.body.error.message).toBe('expenses.errors.recurringFinished');
    });

    it('a non-USD schedule without a rate cannot be saved; with one it stores the snapshot', async () => {
      const noRate = await http()
        .post(`${BASE}/recurring-expenses`)
        .set('Authorization', as('OWNER'))
        .send(schedule({ currency: 'VES', amount: '755.16' }))
        .expect(422);
      expect(noRate.body.error.fieldErrors.currency).toEqual(['expenses.errors.rateMissing']);

      await admin.exchangeRate.create({
        data: {
          date: new Date(firstOfMonth(1)),
          currency: 'VES',
          usdRate: '755.16',
          source: 'MANUAL',
        },
      });
      const ok = await http()
        .post(`${BASE}/recurring-expenses`)
        .set('Authorization', as('OWNER'))
        .send(schedule({ currency: 'VES', amount: '755.16', frequency: 'TRIMESTRAL' }))
        .expect(201);
      expect(ok.body).toMatchObject({ usdRate: '755.16', monthlyAmountUsd: '0.33' });
    });

    it('lists and filters schedules', async () => {
      await http()
        .post(`${BASE}/recurring-expenses`)
        .set('Authorization', as('OWNER'))
        .send(schedule())
        .expect(201);
      await http()
        .post(`${BASE}/recurring-expenses`)
        .set('Authorization', as('OWNER'))
        .send(schedule({ name: 'Dominio', frequency: 'ANUAL' }))
        .expect(201);

      const all = await http()
        .get(`${BASE}/recurring-expenses`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      const annual = await http()
        .get(`${BASE}/recurring-expenses?frequency=ANUAL`)
        .set('Authorization', as('OWNER'))
        .expect(200);

      expect(all.body.items.map((r: { name: string }) => r.name)).toEqual([
        'Dominio',
        'Hosting mensual (e2e)',
      ]);
      expect(annual.body.items.map((r: { name: string }) => r.name)).toEqual(['Dominio']);
    });
  });

  describe('registrations and receipts (C23)', () => {
    it('registers the tag target and the note target of expenses, and the facet filters by tag', async () => {
      const created = await create();
      const tag = await admin.tag.create({ data: { name: 'e2e-tag', color: '#112233' } });

      const resolver = app
        .get<TaggableTargetRegistry>(TAGGABLE_TARGET_REGISTRY)
        .resolverFor('EXPENSE');
      expect(await resolver.resolve(created.id)).toEqual({
        label: 'Hosting (e2e)',
        clientId: null,
      });
      expect(await resolver.resolve('nope')).toBeNull();
      const refs = await app
        .get(NoteLinkTargetRegistry)
        .requireLive([{ entityType: 'EXPENSE', entityId: created.id }], () => 'links');
      expect(refs[0]).toMatchObject({ type: 'EXPENSE', id: created.id, code: 'GAS-0001' });

      await admin.tagAssignment.create({ data: { tagId: tag.id, expenseId: created.id } });
      const tagged = await http()
        .get(`${BASE}/expenses?tagId=${tag.id}`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(tagged.body.items.map((r: { id: string }) => r.id)).toEqual([created.id]);
      const other = await http()
        .get(`${BASE}/expenses?tagId=other`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(other.body.total).toBe(0);
    });

    it('claims a READY receipt once, exposes it as an expense download claim, and refuses an unknown file', async () => {
      const owner = await admin.user.findFirstOrThrow({ where: { role: 'OWNER' } });
      await admin.file.create({
        data: {
          id: 'file_e2e',
          storageKey: 'expenses/e2e-receipt.pdf',
          bucket: 'test',
          originalName: 'receipt.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1000,
          status: 'READY',
          uploadedById: owner.id,
        },
      });

      const created = await create({ receiptFileId: 'file_e2e' });
      expect(created.receiptFileId).toBe('file_e2e');
      expect(
        await app.get<FileAccessRegistry>(FILE_ACCESS_REGISTRY).claimsFor('file_e2e'),
      ).toContainEqual({
        kind: 'resource',
        resource: 'expense',
      });

      const twice = await http()
        .post(`${BASE}/expenses`)
        .set('Authorization', as('OWNER'))
        .send(body({ receiptFileId: 'file_e2e' }))
        .expect(422);
      expect(twice.body.error.fieldErrors.receiptFileId).toEqual([
        'expenses.errors.receiptUnavailable',
      ]);
      const unknown = await http()
        .post(`${BASE}/expenses`)
        .set('Authorization', as('OWNER'))
        .send(body({ receiptFileId: 'file_nope' }))
        .expect(422);
      expect(unknown.body.error.fieldErrors.receiptFileId).toEqual([
        'expenses.errors.receiptUnavailable',
      ]);
      expect(await admin.expense.count()).toBe(1);
    });
  });
});
