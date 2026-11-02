import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsModule } from '../../src/modules/finance/accounts.module';
import { ExpensesModule } from '../../src/modules/finance/expenses.module';
import { InvoicesModule } from '../../src/modules/finance/invoices.module';
import { PaymentsModule } from '../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../src/modules/identity/infrastructure/matrix-authorization';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { ExportSourceRegistry } from '../../src/shared/application/ports/export-source.port';
import { SearchReindexRegistry } from '../../src/shared/application/ports/search-reindex.port';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import { ForbiddenError } from '../../src/shared/domain/domain-error';
import type { EntityType } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { createTestApp } from '../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** `YYYY-MM-DD` of the business day plus `days` (UTC arithmetic on the current date). */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe('finance list search converges on SearchEntry (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  let owner: CurrentUser;
  let member: CurrentUser;
  let authenticator: FakeAuthenticator;
  let zelle: string;
  let categoryId: string;

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [AccountsModule, InvoicesModule, PaymentsModule, ExpensesModule],
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
    const users: Record<string, CurrentUser> = {};
    for (const role of ['OWNER', 'MEMBER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_search_convergence_${role.toLowerCase()}`,
          email: `search-convergence-${role.toLowerCase()}@example.test`,
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
    }
    owner = users.OWNER as CurrentUser;
    member = users.MEMBER as CurrentUser;
    token = authenticator.issue(owner);
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
        id: 'pry_a',
        code: 'PRY-0001',
        name: 'Proyecto A',
        summary: 'Resumen',
        clients: { create: [{ clientId: 'cli_e2e' }] },
      },
    });
    await admin.account.create({
      data: {
        id: 'acc_seed',
        name: 'Caja',
        type: 'BANCO_INTERNACIONAL',
        currency: 'USD',
        openingBalance: '0.00',
        openingDate: new Date('2026-01-01'),
      },
    });
    zelle = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).id;
    categoryId = (await admin.expenseCategory.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
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

  const invoiceBody = (invoiceNumber: string) => ({
    clientId: 'cli_e2e',
    invoiceNumber,
    issueDate: dayOffset(-2),
    dueDate: dayOffset(28),
    currency: 'USD',
    usdRate: '1',
    lines: [{ description: 'Diseño de logotipo', unitPrice: '100.00', ivaRate: null }],
  });
  const paymentBody = () => ({
    clientId: 'cli_e2e',
    date: dayOffset(-1),
    accountId: 'acc_seed',
    methodId: zelle,
    currency: 'USD',
    amount: '100.00',
    igtfAmount: '0.00',
    feeAmount: '0.00',
    usdRate: '1',
    reference: 'OP-777',
  });
  const expenseBody = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-05',
    description: 'Hosting (e2e)',
    vendor: 'Proveedor Uno',
    categoryId,
    currency: 'USD',
    amount: '50.00',
    usdRate: '1',
    status: 'PENDIENTE',
    ...over,
  });

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

  describe('reindex and export sources are registered by the finance modules', () => {
    it('registers INVOICE, PAYMENT, EXPENSE and ACCOUNT reindex sources and the three exports', () => {
      expect(app.get(SearchReindexRegistry).types()).toEqual(
        expect.arrayContaining(['INVOICE', 'PAYMENT', 'EXPENSE', 'ACCOUNT']),
      );
      expect(app.get(ExportSourceRegistry).entities()).toEqual(
        expect.arrayContaining(['INVOICE', 'PAYMENT', 'EXPENSE']),
      );
    });

    async function storedEntry(entityType: EntityType, entityId: string) {
      const row = await admin.searchEntry.findUniqueOrThrow({
        where: { entityType_entityId: { entityType, entityId } },
      });
      return {
        entityType,
        entityId,
        code: row.code,
        title: row.title,
        subtitle: row.subtitle,
        body: row.body,
        status: row.status,
        archived: row.archived,
      };
    }

    it('the source entry of each type equals the entry the API mutation left', async () => {
      const invoice = (await post('/invoices', invoiceBody('E2E-1')).expect(201)).body as {
        id: string;
      };
      const payment = (await post('/payments', paymentBody()).expect(201)).body as { id: string };
      const expense = (await post('/expenses', expenseBody()).expect(201)).body as { id: string };
      const account = (await post('/accounts', accountBody({ notes: 'nota' })).expect(201))
        .body as { id: string };
      const registry = app.get(SearchReindexRegistry);

      for (const [type, id] of [
        ['INVOICE', invoice.id],
        ['PAYMENT', payment.id],
        ['EXPENSE', expense.id],
        ['ACCOUNT', account.id],
      ] as const) {
        expect(await registry.get(type)?.entryOf(id), type).toEqual(await storedEntry(type, id));
      }
    });

    it('lists find invoices, payments and expenses by the text their entries hold', async () => {
      await post('/invoices', invoiceBody('E2E-2')).expect(201);
      await post('/payments', paymentBody()).expect(201);
      await post('/expenses', expenseBody()).expect(201);

      expect((await get('/invoices?q=logotipo').expect(200)).body.total).toBe(1);
      expect((await get('/invoices?q=kairos').expect(200)).body.total).toBe(1);
      expect((await get('/payments?q=OP-777').expect(200)).body.total).toBe(1);
      expect((await get('/payments?q=kairos').expect(200)).body.total).toBe(1);
      expect((await get('/expenses?q=proveedor').expect(200)).body.total).toBe(1);
      expect((await get('/invoices?q=inexistente').expect(200)).body.total).toBe(0);
    });

    it('the export sources read through the list: facets pass through and the list gate decides', async () => {
      await post('/expenses', expenseBody({ description: 'Pendiente' })).expect(201);
      await post('/expenses', expenseBody({ description: 'Otro pendiente' })).expect(201);
      await post('/expenses', expenseBody({ description: 'Anulable' })).expect(201);
      const expenses = app.get(ExportSourceRegistry).get('EXPENSE');
      const query = {
        sort: null,
        archived: 'exclude' as const,
        filters: { status: 'PENDIENTE' },
      };

      const page = await expenses?.read(owner, query, { page: 1, pageSize: 25 });
      const none = await expenses?.read(
        owner,
        { ...query, filters: { status: 'PAGADO' } },
        { page: 1, pageSize: 25 },
      );

      expect(page?.total).toBe(3);
      expect(page?.rows).toHaveLength(3);
      expect(none?.total).toBe(0);
      for (const entity of ['INVOICE', 'PAYMENT', 'EXPENSE']) {
        await expect(
          app
            .get(ExportSourceRegistry)
            .get(entity)
            ?.read(member, { ...query, filters: {} }, { page: 1, pageSize: 25 }),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });
});
