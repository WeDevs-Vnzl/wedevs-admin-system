import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentRecordsModule } from '../../src/modules/documents/document-records.module';
import { PaymentsModule } from '../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../src/modules/identity/application/matrix-authorization';
import { FILE_STORAGE } from '../../src/modules/platform/application/ports/file-storage.port';
import { DocumentTypesModule } from '../../src/modules/settings/document-types.module';
import { FinanceCatalogsModule } from '../../src/modules/settings/finance-catalogs.module';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { InMemoryFileStorage } from '../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { createTestApp } from '../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/**
 * A catalog rename reaches the lists of its dependants in the same request sequence, with no job
 * (DT-166, X18): the method rename moves the payment entry's body, the type rename the document entry's
 * subtitle, and `q` on the new name finds the record.
 */
describe('catalog renames repair the dependants search entries (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  let owner: CurrentUser;
  let zelle: string;
  let zelleName: string;
  let ndaName: string;
  const authenticator = new FakeAuthenticator();

  beforeAll(async () => {
    zelleName = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).name;
    ndaName = (await admin.documentType.findUniqueOrThrow({ where: { id: 'dtyp_nda' } })).name;
    app = await createTestApp({
      modules: [FinanceCatalogsModule, DocumentTypesModule, PaymentsModule, DocumentRecordsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FILE_STORAGE, useValue: new InMemoryFileStorage() },
      ],
    });
  });

  afterAll(async () => {
    await truncateBusinessTables(admin);
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    const row = await admin.user.create({
      data: {
        clerkId: 'user_e2e_search_dependents',
        email: 'search-dependents@example.test',
        name: 'Owner',
        role: 'OWNER',
      },
    });
    owner = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: 'Owner',
    };
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
    // The catalogs survive the truncate: put back the names the previous test renamed.
    await admin.paymentMethod.updateMany({ where: { code: 'ZELLE' }, data: { name: zelleName } });
    await admin.documentType.update({ where: { id: 'dtyp_nda' }, data: { name: ndaName } });
    zelle = (await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } })).id;
  });

  const http = () => request(app.getHttpServer());
  const post = (path: string, body: unknown) =>
    http()
      .post(`${BASE}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  const patch = (path: string, body: unknown) =>
    http()
      .patch(`${BASE}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);
  const get = (path: string) =>
    http().get(`${BASE}${path}`).set('Authorization', `Bearer ${token}`);

  describe('payment method rename', () => {
    const paymentBody = () => ({
      clientId: 'cli_e2e',
      date: '2026-10-05',
      accountId: 'acc_seed',
      methodId: zelle,
      currency: 'USD',
      amount: '100.00',
      igtfAmount: '0.00',
      feeAmount: '0.00',
      usdRate: '1',
      reference: 'OP-777',
    });

    async function renameZelle(name: string, over: Record<string, unknown> = {}) {
      const list = (await get('/payment-methods').expect(200)).body as Record<string, unknown>[];
      const row = list.find((method) => method.id === zelle) as Record<string, unknown>;
      return patch(`/payment-methods/${zelle}`, {
        name,
        nameEn: row.nameEn,
        requiresReference: row.requiresReference,
        suggestsIgtf: row.suggestsIgtf,
        active: row.active,
        ...over,
      });
    }

    it('q on the new name finds the payment, and the old name no longer does', async () => {
      await post('/payments', paymentBody()).expect(201);
      expect((await get('/payments?q=zelle').expect(200)).body.total).toBe(1);

      expect((await renameZelle('Transferencia Digital')).status).toBe(200);

      expect((await get('/payments?q=digital').expect(200)).body.total).toBe(1);
      expect((await get('/payments?q=zelle').expect(200)).body.total).toBe(0);
      expect((await get('/payments?q=OP-777').expect(200)).body.total).toBe(1);
    });

    it('an edit that keeps the name leaves the payment entry untouched', async () => {
      const payment = (await post('/payments', paymentBody()).expect(201)).body as { id: string };
      const entryOf = () =>
        admin.searchEntry.findUniqueOrThrow({
          where: { entityType_entityId: { entityType: 'PAYMENT', entityId: payment.id } },
        });
      const before = await entryOf();

      expect((await renameZelle('Zelle', { nameEn: 'Zelle transfer' })).status).toBe(200);

      const after = await entryOf();
      expect(after.body).toBe(before.body);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });
  });

  describe('document type rename', () => {
    const typeId = 'dtyp_nda';

    async function createDocument() {
      return post('/documents', {
        title: 'Acuerdo con Kairos',
        typeId,
        summary: 'Acuerdo de confidencialidad',
        effectiveDate: '2026-10-01',
        expiresAt: '2027-10-01',
        links: [{ entityType: 'CLIENT', entityId: 'cli_e2e' }],
      });
    }

    async function renameType(name: string) {
      const current = (await get(`/document-types/${typeId}`).expect(200)).body as {
        categoryId?: string;
        category: { id: string };
        nameEn: string | null;
        requiresSignature: boolean;
        hasExpiration: boolean;
        defaultFormat: string;
        active: boolean;
      };
      return patch(`/document-types/${typeId}`, {
        categoryId: current.category.id,
        name,
        nameEn: current.nameEn,
        requiresSignature: current.requiresSignature,
        hasExpiration: current.hasExpiration,
        defaultFormat: current.defaultFormat,
        active: current.active,
      });
    }

    it('q on the new name finds the document, and the old name no longer does', async () => {
      const old = ((await get(`/document-types/${typeId}`).expect(200)).body as { name: string })
        .name;
      expect((await createDocument()).status).toBe(201);
      expect((await get(`/documents?q=${encodeURIComponent(old)}`).expect(200)).body.total).toBe(1);

      expect((await renameType('Convenio Reservado')).status).toBe(200);

      expect((await get('/documents?q=reservado').expect(200)).body.total).toBe(1);
      const stale = (await get(`/documents?q=${encodeURIComponent(old)}`).expect(200)).body as {
        total: number;
      };
      // the old name may survive in the title; the subtitle no longer carries it
      const entry = await admin.searchEntry.findFirstOrThrow({ where: { entityType: 'DOCUMENT' } });
      expect(entry.subtitle).toBe('Convenio Reservado');
      expect(stale.total).toBeLessThanOrEqual(1);
    });
  });
});
