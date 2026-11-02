import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsModule } from '../../src/modules/commercial/clients.module';
import { NotesModule } from '../../src/modules/commercial/notes.module';
import { ProjectsModule } from '../../src/modules/commercial/projects.module';
import { InvoicesModule } from '../../src/modules/finance/invoices.module';
import { PaymentsModule } from '../../src/modules/finance/payments.module';
import { MatrixAuthorization } from '../../src/modules/identity/infrastructure/matrix-authorization';
import { FILE_STORAGE } from '../../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { ExportSourceRegistry } from '../../src/shared/application/ports/export-source.port';
import { SearchReindexRegistry } from '../../src/shared/application/ports/search-reindex.port';
import { AUTHORIZATION } from '../../src/shared/application/ports/tokens';
import type { EntityType } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { InMemoryFileStorage } from '../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { createTestApp } from '../support/test-app';

// Each request touches the local database; a loaded disk can stall a commit for seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** `YYYY-MM-DD` of the business day plus `days` (UTC arithmetic on the current date). */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('commercial lists converge on SearchEntry (e2e)', () => {
  let app: NestExpressApplication;
  let token: string;
  let zelle: string;
  const authenticator = new FakeAuthenticator();

  beforeAll(async () => {
    app = await createTestApp({
      modules: [ClientsModule, ProjectsModule, NotesModule, InvoicesModule, PaymentsModule],
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
        clerkId: 'user_e2e_commercial_conv',
        email: 'commercial-conv@example.test',
        name: 'Owner',
        role: 'OWNER',
      },
    });
    const owner: CurrentUser = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: row.name,
    };
    token = authenticator.issue(owner);
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
  const projectForm = (clientId: string, over: Record<string, unknown> = {}) => ({
    name: 'Sitio corporativo',
    summary: 'Un sitio nuevo',
    status: 'PROPUESTA',
    clients: [{ clientId, role: 'Contratante' }],
    technologyIds: [],
    tagIds: [],
    links: [],
    ...over,
  });
  const invoiceForm = (clientId: string, projectId: string) => ({
    clientId,
    invoiceNumber: 'E2E-1',
    issueDate: dayOffset(-2),
    dueDate: dayOffset(28),
    currency: 'USD',
    usdRate: '1',
    lines: [{ description: 'Diseño', projectId, unitPrice: '100.00', ivaRate: null }],
  });
  const paymentForm = (clientId: string) => ({
    clientId,
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
  const total = async (path: string) => (await get(path).expect(200)).body.total as number;

  async function seedClientWithDependants() {
    const client = (await post('/clients', clientForm()).expect(201)).body as { id: string };
    const project = (await post('/projects', projectForm(client.id)).expect(201)).body as {
      id: string;
    };
    const invoice = (await post('/invoices', invoiceForm(client.id, project.id)).expect(201))
      .body as { id: string };
    const payment = (await post('/payments', paymentForm(client.id)).expect(201)).body as {
      id: string;
    };
    return { client, project, invoice, payment };
  }

  describe('rename a client (DT-166)', () => {
    it('q on the new name finds its client, project, invoice and payment at once, with no job', async () => {
      const { client } = await seedClientWithDependants();
      expect(await total('/projects?q=kairos')).toBe(1);

      await patch(`/clients/${client.id}`, clientForm({ tradeName: 'Ñandú Café Studio' })).expect(
        200,
      );

      for (const path of ['clients', 'projects', 'invoices', 'payments']) {
        expect(await total(`/${path}?q=nandu%20cafe`), path).toBe(1);
        expect(await total(`/${path}?q=NANDÚ`), path).toBe(1);
      }
      expect(await total('/projects?q=studio')).toBe(1);
      // The legal name did not change: the project is still found through it, the trade name left the lists.
      expect(await total('/projects?q=tornilleria')).toBe(1);
      expect(await total('/clients?q=kairos%20studio')).toBe(0);
      expect(await total('/invoices?q=kairos%20studio')).toBe(0);
      expect(await total('/payments?q=kairos%20studio')).toBe(0);
    });

    it('a legal name change moves the project entry, and the lists keep their other columns', async () => {
      const { client } = await seedClientWithDependants();

      await patch(
        `/clients/${client.id}`,
        clientForm({ legalName: 'Ferretería Aurora C.A.', email: 'ventas@aurora.example.com' }),
      ).expect(200);

      expect(await total('/projects?q=ferreteria')).toBe(1);
      expect(await total('/projects?q=tornilleria')).toBe(0);
      expect(await total('/clients?q=ventas@aurora')).toBe(1);
      expect(await total('/clients?q=hola@kairos')).toBe(0);
      expect(await total('/clients?q=J-40111222')).toBe(1);
      expect(await total('/clients?q=CLI-0001')).toBe(1);
    });

    it('archive and restore keep the index correct, and a restored record shows the current label', async () => {
      const client = (await post('/clients', clientForm()).expect(201)).body as {
        id: string;
      };
      await post('/projects', projectForm(client.id)).expect(201);
      await patch(`/clients/${client.id}`, clientForm({ tradeName: 'Aurora Digital' })).expect(200);

      await post(`/clients/${client.id}/archive`, { confirm: true }).expect(200);
      expect(await total('/clients?q=aurora')).toBe(0);
      expect(await total('/clients?q=aurora&archived=only')).toBe(1);
      expect(await total('/clients?q=kairos%20studio&archived=include')).toBe(0);

      await post(`/clients/${client.id}/restore`, {}).expect(200);
      expect(await total('/clients?q=aurora')).toBe(1);
      expect(await total('/clients?q=kairos%20studio')).toBe(0);
    });
  });

  describe('lists keep the columns they searched', () => {
    it('contacts: name, position, e-mail and phone', async () => {
      const client = (await post('/clients', clientForm()).expect(201)).body as {
        id: string;
      };
      await post(`/clients/${client.id}/contacts`, {
        fullName: 'María López',
        position: 'Directora técnica',
        email: 'maria@kairos.example.com',
        phone: '+584141112233',
      }).expect(201);
      await post(`/clients/${client.id}/contacts`, {
        fullName: 'Otro Contacto',
        email: 'otro@example.test',
      }).expect(201);

      for (const q of ['maria', 'DIRECTORA', 'maria@kairos', '4141112233']) {
        expect(await total(`/clients/${client.id}/contacts?q=${encodeURIComponent(q)}`), q).toBe(1);
      }
    });

    it('notes: title and plain text, accents ignored', async () => {
      const client = (await post('/clients', clientForm()).expect(201)).body as { id: string };
      const links = [{ entityType: 'CLIENT', entityId: client.id }];
      await post('/notes', {
        title: 'Reunión de alcance',
        content: doc('Se acordó la integración con facturación'),
        links,
      }).expect(201);
      await post('/notes', { content: doc('Otra nota sin título'), links }).expect(201);

      expect(await total('/notes?q=reunion')).toBe(1);
      expect(await total('/notes?q=integracion')).toBe(1);
      expect(await total('/notes?q=nota')).toBe(1);
      expect(await total('/notes?q=inexistente')).toBe(0);
    });
  });

  describe('reindex and export sources', () => {
    it('registers CLIENT, CONTACT, PROJECT and NOTE reindex and export sources', () => {
      expect(app.get(SearchReindexRegistry).types()).toEqual(
        expect.arrayContaining(['CLIENT', 'CONTACT', 'PROJECT', 'NOTE']),
      );
      expect(app.get(ExportSourceRegistry).entities()).toEqual(
        expect.arrayContaining(['CLIENT', 'CONTACT', 'PROJECT', 'NOTE']),
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

    it('the source entry of each type equals the entry the API mutations left, after a rename', async () => {
      const { client, project } = await seedClientWithDependants();
      const contact = (
        await post(`/clients/${client.id}/contacts`, {
          fullName: 'María López',
          email: 'maria@kairos.example.com',
        }).expect(201)
      ).body as { id: string };
      const note = (
        await post('/notes', {
          title: 'Reunión',
          content: doc('Texto de la reunión'),
          links: [{ entityType: 'CLIENT', entityId: client.id }],
        }).expect(201)
      ).body as { id: string };
      await patch(`/clients/${client.id}`, clientForm({ tradeName: 'Nombre Nuevo' })).expect(200);
      const registry = app.get(SearchReindexRegistry);

      for (const [type, id] of [
        ['CLIENT', client.id],
        ['CONTACT', contact.id],
        ['PROJECT', project.id],
        ['NOTE', note.id],
      ] as const) {
        expect(await registry.get(type)?.entryOf(id), type).toEqual(await storedEntry(type, id));
      }
    });

    it('the export sources read through the list, with the list gates', async () => {
      const { client } = await seedClientWithDependants();
      const query = { sort: null, archived: 'exclude' as const, filters: {} };
      const exports = app.get(ExportSourceRegistry);
      const owner = {
        userId: (await admin.user.findFirstOrThrow()).id,
        clerkId: 'user_e2e_commercial_conv',
        role: 'OWNER' as const,
        email: 'commercial-conv@example.test',
        name: 'Owner',
      };

      for (const entity of ['CLIENT', 'PROJECT', 'NOTE']) {
        const result = await exports.get(entity)?.read(owner, query, { page: 1, pageSize: 25 });
        expect(result?.total, entity).toBe(entity === 'NOTE' ? 0 : 1);
      }
      const contacts = await exports
        .get('CONTACT')
        ?.read(owner, { ...query, filters: { clientId: client.id } }, { page: 1, pageSize: 25 });
      expect(contacts?.total).toBe(0);
    });
  });
});
