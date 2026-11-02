import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClientsModule } from '../../../src/modules/commercial/clients.module';
import { NotesModule } from '../../../src/modules/commercial/notes.module';
import { ProjectsModule } from '../../../src/modules/commercial/projects.module';
import { DocumentRecordsModule } from '../../../src/modules/documents/document-records.module';
import { AccountsModule } from '../../../src/modules/finance/accounts.module';
import { ExpensesModule } from '../../../src/modules/finance/expenses.module';
import { InvoicesModule } from '../../../src/modules/finance/invoices.module';
import { PaymentsModule } from '../../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { ReindexAll } from '../../../src/modules/intelligence/application/use-cases/search/reindex-all.use-case';
import { SearchModule } from '../../../src/modules/intelligence/search.module';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import { DocumentTypesModule } from '../../../src/modules/settings/document-types.module';
import { FinanceCatalogsModule } from '../../../src/modules/settings/finance-catalogs.module';
import { SYSTEM_ACTOR } from '../../../src/shared/application/actor';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { EntityType } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const BASE = '/api/v1';
const TYPES: readonly EntityType[] = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'NOTE',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'ACCOUNT',
  'DOCUMENT',
];
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

const dayOffset = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * DT-166, DT-177: after the rename paths (client, payment method, document type) have run, `ReindexAll`
 * rebuilds every entry from its source and finds no difference. A rename that left one label stale would
 * show here as `updated > 0` for the type that holds it.
 */
describe('ReindexAll after renames (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  const authenticator = new FakeAuthenticator();

  beforeAll(async () => {
    app = await createTestApp({
      modules: [
        SearchModule,
        ClientsModule,
        ProjectsModule,
        NotesModule,
        InvoicesModule,
        PaymentsModule,
        ExpensesModule,
        AccountsModule,
        DocumentRecordsModule,
        FinanceCatalogsModule,
        DocumentTypesModule,
      ],
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

  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const post = (path: string, body: unknown) =>
    http()
      .post(`${BASE}${path}`)
      .set(auth())
      .send(body as object);
  const patch = (path: string, body: unknown) =>
    http()
      .patch(`${BASE}${path}`)
      .set(auth())
      .send(body as object);
  const get = (path: string) => http().get(`${BASE}${path}`).set(auth());
  const idOf = (res: request.Response): string => (res.body as { id: string }).id;

  const clientForm = (over: Record<string, unknown> = {}) => ({
    kind: 'EMPRESA',
    tradeName: 'Kairos Studio',
    legalName: 'Tornillería Kairos C.A.',
    taxId: 'J-40111222-3',
    country: 'VE',
    address: 'Av. Principal, Caracas',
    phone: '+584121234567',
    email: 'hola@kairos.example.com',
    ...over,
  });
  const invoiceForm = (clientId: string, projectId: string | null, invoiceNumber: string) => ({
    clientId,
    invoiceNumber,
    issueDate: dayOffset(-2),
    dueDate: dayOffset(28),
    currency: 'USD',
    usdRate: '1',
    lines: [{ description: 'Diseño', projectId, unitPrice: '100.00', ivaRate: null }],
  });
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

  async function entryOf(entityType: EntityType, entityId: string) {
    return admin.searchEntry.findUniqueOrThrow({
      where: { entityType_entityId: { entityType, entityId } },
    });
  }

  it('finds no difference after a client, a payment method and a document type are renamed', async () => {
    await truncateBusinessTables(admin);
    const user = await admin.user.create({
      data: {
        clerkId: 'user_e2e_reindex_renames',
        email: 'reindex-renames@example.test',
        name: 'Owner',
        role: 'OWNER',
      },
    });
    token = authenticator.issue({
      userId: user.id,
      clerkId: user.clerkId,
      role: 'OWNER',
      email: user.email,
      name: 'Owner',
    });
    const zelle = await admin.paymentMethod.findFirstOrThrow({ where: { code: 'ZELLE' } });
    const nda = await admin.documentType.findUniqueOrThrow({ where: { id: 'dtyp_nda' } });
    const category = await admin.expenseCategory.findFirstOrThrow({ orderBy: { id: 'asc' } });

    try {
      // 1 and 2: one row of each type, linked to the client.
      const clientId = idOf(await post('/clients', clientForm()).expect(201));
      await post(`/clients/${clientId}/contacts`, {
        fullName: 'María López',
        position: 'Directora',
        email: 'maria@kairos.example.com',
      }).expect(201);
      const projectId = idOf(
        await post('/projects', {
          name: 'Sitio corporativo',
          summary: 'Un sitio nuevo',
          status: 'PROPUESTA',
          clients: [{ clientId, role: 'Contratante' }],
          technologyIds: [],
          tagIds: [],
          links: [],
        }).expect(201),
      );
      await post('/notes', {
        title: 'Reunión',
        content: doc('Texto de la reunión'),
        links: [{ entityType: 'CLIENT', entityId: clientId }],
      }).expect(201);
      await post('/invoices', invoiceForm(clientId, projectId, 'RIX-1')).expect(201);
      const archivedInvoice = idOf(
        await post('/invoices', invoiceForm(clientId, projectId, 'RIX-2')).expect(201),
      );
      const accountId = idOf(
        await post('/accounts', {
          name: 'Zelle USD',
          type: 'BILLETERA_DIGITAL',
          currency: 'USD',
          openingBalance: '1000.00',
          openingDate: '2026-01-01',
        }).expect(201),
      );
      await post('/payments', {
        clientId,
        date: dayOffset(-1),
        accountId,
        methodId: zelle.id,
        currency: 'USD',
        amount: '100.00',
        igtfAmount: '0.00',
        feeAmount: '0.00',
        usdRate: '1',
        reference: 'OP-777',
      }).expect(201);
      await post('/expenses', {
        date: '2026-10-05',
        description: 'Hosting',
        vendor: 'Proveedor Uno',
        categoryId: category.id,
        currency: 'USD',
        amount: '50.00',
        usdRate: '1',
        status: 'PENDIENTE',
      }).expect(201);
      const documentForm = (title: string) => ({
        title,
        typeId: nda.id,
        summary: 'Acuerdo de confidencialidad',
        effectiveDate: '2026-10-01',
        expiresAt: '2027-10-01',
        links: [{ entityType: 'CLIENT', entityId: clientId }],
      });
      await post('/documents', documentForm('Acuerdo con Kairos')).expect(201);
      const archivedDocument = idOf(
        await post('/documents', documentForm('Acuerdo viejo')).expect(201),
      );
      await post(`/invoices/${archivedInvoice}/archive`, { confirm: true }).expect(200);
      await post(`/documents/${archivedDocument}/archive`, { confirm: true }).expect(200);

      // 3: the three rename paths.
      await patch(
        `/clients/${clientId}`,
        clientForm({ tradeName: 'Ñandú Café Studio', legalName: 'Ferretería Aurora C.A.' }),
      ).expect(200);
      const method = (await get('/payment-methods').expect(200)).body as Record<string, unknown>[];
      const methodRow = method.find((row) => row.id === zelle.id) as Record<string, unknown>;
      await patch(`/payment-methods/${zelle.id}`, {
        name: 'Transferencia Digital',
        nameEn: methodRow.nameEn,
        requiresReference: methodRow.requiresReference,
        suggestsIgtf: methodRow.suggestsIgtf,
        active: methodRow.active,
      }).expect(200);
      await patch(`/document-types/${nda.id}`, {
        categoryId: nda.categoryId,
        name: 'Convenio Reservado',
        nameEn: nda.nameEn,
        requiresSignature: nda.requiresSignature,
        hasExpiration: nda.hasExpiration,
        defaultFormat: nda.defaultFormat,
        active: nda.active,
      }).expect(200);

      // 4 and 5: the repair finds nothing to repair, and counts what it walked.
      const reindex = app.get(ReindexAll);
      const result = await reindex.execute(SYSTEM_ACTOR);
      process.stdout.write(`[reindex-after-renames] ${JSON.stringify(result)}\n`);
      for (const type of TYPES) {
        const run = result[type];
        expect(run?.scanned, `${type} scanned`).toBeGreaterThan(0);
        expect(run?.created, `${type} created`).toBe(0);
        expect(run?.updated, `${type} updated`).toBe(0);
        expect(run?.removed, `${type} removed`).toBe(0);
        expect(run?.skippedIds, `${type} skipped`).toEqual([]);
      }

      // Negative control: a stale label is found and repaired, so the zeros above can fail.
      const payment = await admin.searchEntry.findFirstOrThrow({
        where: { entityType: 'PAYMENT' },
      });
      await admin.$executeRaw`UPDATE "SearchEntry" SET "subtitle" = 'Etiqueta vieja' WHERE "entityType" = 'PAYMENT'::"EntityType" AND "entityId" = ${payment.entityId}`;
      expect((await entryOf('PAYMENT', payment.entityId)).subtitle).toBe('Etiqueta vieja');
      const tampered = await reindex.execute(SYSTEM_ACTOR);
      expect(tampered.PAYMENT?.updated).toBe(1);
      expect((await entryOf('PAYMENT', payment.entityId)).subtitle).not.toBe('Etiqueta vieja');
    } finally {
      // The catalogs survive `truncateBusinessTables`: put the seeded names back.
      await admin.paymentMethod.update({ where: { id: zelle.id }, data: { name: zelle.name } });
      await admin.documentType.update({ where: { id: nda.id }, data: { name: nda.name } });
    }
  });
});
