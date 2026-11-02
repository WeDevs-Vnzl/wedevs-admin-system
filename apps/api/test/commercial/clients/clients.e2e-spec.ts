import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsModule } from '../../../src/modules/commercial/clients.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { makeProject } from '../../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

// Every test truncates the business tables; a shared box can be slow doing it.
vi.setConfig({ testTimeout: 30_000 });

const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

const form = (over: Record<string, unknown> = {}) => ({
  kind: 'EMPRESA',
  tradeName: 'Nube Austral',
  legalName: 'Nube Austral C.A.',
  taxId: 'J-40111222-3',
  country: 'VE',
  address: 'Av. Principal, Caracas',
  phone: '+584121234567',
  ...over,
});

describe('clients and contacts (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [ClientsModule],
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
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_${role.toLowerCase()}`,
          email: `${role.toLowerCase()}@example.test`,
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
  }, 60_000);

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());

  const createClient = (role: UserRole, over: Record<string, unknown> = {}) =>
    http().post('/api/v1/clients').set('Authorization', as(role)).send(form(over));
  const createContact = (role: UserRole, clientId: string, over: Record<string, unknown> = {}) =>
    http()
      .post(`/api/v1/clients/${clientId}/contacts`)
      .set('Authorization', as(role))
      .send({ fullName: 'Ana Pérez', email: 'ana@kairos.example.com', ...over });

  it('refuses unauthenticated calls with UNAUTHENTICATED', async () => {
    const res = await http().get('/api/v1/clients').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  describe('HU-03 create', () => {
    it('creates CLI-0001 as PROSPECTO with the CREATE entry, the search entry and the metrics row (CA2, CA4)', async () => {
      const res = await createClient('ADMIN').expect(201);
      expect(res.body).toMatchObject({
        code: 'CLI-0001',
        status: 'PROSPECTO',
        tradeName: 'Nube Austral',
        taxId: 'J-40111222-3',
        activatedAt: null,
        archivedAt: null,
        contacts: [],
        tags: [],
      });
      expect(res.body).not.toHaveProperty('financials');
      const id = res.body.id as string;

      const entries = await admin.activityLog.findMany({ where: { entityType: 'CLIENT' } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        action: 'CREATE',
        entityId: id,
        entityLabel: 'Nube Austral',
        clientId: id,
        actorType: 'USER',
        metadata: { code: 'CLI-0001' },
      });
      expect(
        await admin.searchEntry.findUnique({
          where: { entityType_entityId: { entityType: 'CLIENT', entityId: id } },
        }),
      ).toMatchObject({
        code: 'CLI-0001',
        title: 'Nube Austral',
        status: 'PROSPECTO',
        archived: false,
      });
      const metrics = await admin.clientMetrics.findUnique({ where: { clientId: id } });
      expect(metrics).toMatchObject({ projectCount: 0 });
      // The activity entry bumped lastActivityAt of the same row.
      expect(metrics?.lastActivityAt).not.toBeNull();

      const second = await createClient('OWNER', { taxId: 'J-40111222-4' }).expect(201);
      expect(second.body.code).toBe('CLI-0002');
    });

    it('answers 422 with field errors for a company without a legal name (CA1)', async () => {
      const res = await createClient('ADMIN', { legalName: ' ' }).expect(422);
      expect(res.body.error.fieldErrors.legalName).toEqual(['validation.required']);
      const rif = await createClient('ADMIN', { taxId: '12345' }).expect(422);
      expect(rif.body.error.fieldErrors.taxId).toEqual(['validation.invalidFormat']);
      expect(await admin.client.count()).toBe(0);
    });

    it('answers 409 clients.errors.duplicateTaxId with the holder as entity, however the RIF is typed (CA3)', async () => {
      const first = await createClient('ADMIN', { taxId: 'J-30123456-7' }).expect(201);
      const dup = await createClient('OWNER', { taxId: 'j301234567', tradeName: 'Otro' }).expect(
        409,
      );
      expect(dup.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'clients.errors.duplicateTaxId',
        entity: { type: 'CLIENT', id: first.body.id, code: 'CLI-0001', label: 'Nube Austral' },
      });
      expect(await admin.client.count()).toBe(1);
      // The same tax id in another country is a different client.
      await createClient('ADMIN', { taxId: 'J-30123456-7', country: 'CO' }).expect(201);
    });

    it('refuses a Viewer and a Member (403) without writing anything', async () => {
      for (const role of ['VIEWER', 'MEMBER'] as const) {
        const res = await createClient(role).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(await admin.client.count()).toBe(0);
    });
  });

  describe('update and status', () => {
    it('updates with the diff and reindexes; a status change sets activatedAt once', async () => {
      const created = (await createClient('ADMIN').expect(201)).body;
      const res = await http()
        .patch(`/api/v1/clients/${created.id}`)
        .set('Authorization', as('ADMIN'))
        .send(form({ tradeName: 'Nube Austral Pro', address: 'Otra dirección' }))
        .expect(200);
      expect(res.body.tradeName).toBe('Nube Austral Pro');
      const update = await admin.activityLog.findFirstOrThrow({ where: { action: 'UPDATE' } });
      expect(update.changes).toEqual({
        tradeName: ['Nube Austral', 'Nube Austral Pro'],
        address: 'changed',
      });
      const entry = await admin.searchEntry.findFirstOrThrow({ where: { entityId: created.id } });
      expect(entry.title).toBe('Nube Austral Pro');

      const active = await http()
        .post(`/api/v1/clients/${created.id}/status`)
        .set('Authorization', as('OWNER'))
        .send({ status: 'ACTIVO' })
        .expect(200);
      expect(active.body).toMatchObject({ status: 'ACTIVO' });
      expect(active.body.activatedAt).toMatch(/Z$/);
      expect(await admin.activityLog.count({ where: { action: 'STATUS_CHANGE' } })).toBe(1);
      await http()
        .post(`/api/v1/clients/${created.id}/status`)
        .set('Authorization', as('VIEWER'))
        .send({ status: 'INACTIVO' })
        .expect(403);
      await http()
        .patch('/api/v1/clients/missing')
        .set('Authorization', as('ADMIN'))
        .send(form())
        .expect(404);
    });
  });

  describe('HU-04 contacts', () => {
    it('needs a name and an e-mail or phone (CA1)', async () => {
      const client = (await createClient('ADMIN').expect(201)).body;
      const res = await createContact('ADMIN', client.id, { email: undefined }).expect(422);
      expect(res.body.error.fieldErrors).toEqual({
        email: ['validation.required'],
        phone: ['validation.required'],
      });
      await createContact('ADMIN', 'missing').expect(404);
      await createContact('MEMBER', client.id).expect(403);
    });

    it('keeps one primary: a new or promoted primary unsets the previous one (CA2) and each contact is indexed (CA3)', async () => {
      const client = (await createClient('ADMIN').expect(201)).body;
      const first = (await createContact('ADMIN', client.id, { isPrimary: true }).expect(201)).body;
      const second = (
        await createContact('ADMIN', client.id, { fullName: 'Bruno', isPrimary: true }).expect(201)
      ).body;
      const third = (await createContact('ADMIN', client.id, { fullName: 'Carla' }).expect(201))
        .body;
      expect(
        await admin.contact.findMany({ where: { clientId: client.id, isPrimary: true } }),
      ).toEqual([expect.objectContaining({ id: second.id })]);
      expect(
        await admin.searchEntry.count({ where: { entityType: 'CONTACT', archived: false } }),
      ).toBe(3);

      const promoted = await http()
        .post(`/api/v1/contacts/${third.id}/primary`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(promoted.body).toMatchObject({ id: third.id, isPrimary: true });
      const primaries = await admin.contact.findMany({
        where: { clientId: client.id, isPrimary: true },
      });
      expect(primaries.map((c) => c.id)).toEqual([third.id]);
      expect(first.isPrimary).toBe(true);

      const list = await http()
        .get(`/api/v1/clients/${client.id}/contacts`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(list.body.total).toBe(3);
      expect(list.body.items[0]).toMatchObject({
        id: third.id,
        isPrimary: true,
        clientId: client.id,
      });
      await http()
        .get('/api/v1/clients/missing/contacts')
        .set('Authorization', as('VIEWER'))
        .expect(404);
    });

    it('updates and archives a contact with the clientId on the activity entries', async () => {
      const client = (await createClient('ADMIN').expect(201)).body;
      const contact = (await createContact('ADMIN', client.id, { isPrimary: true }).expect(201))
        .body;
      const updated = await http()
        .patch(`/api/v1/contacts/${contact.id}`)
        .set('Authorization', as('ADMIN'))
        .send({ fullName: 'Ana María', email: 'ana@kairos.example.com', isPrimary: true })
        .expect(200);
      expect(updated.body.fullName).toBe('Ana María');
      await http()
        .post(`/api/v1/contacts/${contact.id}/archive`)
        .set('Authorization', as('MEMBER'))
        .expect(403);
      const archived = await http()
        .post(`/api/v1/contacts/${contact.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(archived.body).toMatchObject({ id: contact.id });
      const del = await admin.activityLog.findFirstOrThrow({
        where: { action: 'DELETE', entityType: 'CONTACT' },
      });
      expect(del).toMatchObject({ clientId: client.id, entityId: contact.id });
      expect(await admin.contact.findUniqueOrThrow({ where: { id: contact.id } })).toMatchObject({
        isPrimary: false,
      });
      await http()
        .patch(`/api/v1/contacts/${contact.id}`)
        .set('Authorization', as('ADMIN'))
        .send({ fullName: 'x', email: 'a@b.test' })
        .expect(404);
    });

    it('restores a contact only through the trash, and not while its client is archived', async () => {
      const client = (await createClient('ADMIN').expect(201)).body;
      const contact = (await createContact('ADMIN', client.id).expect(201)).body;
      await http()
        .post(`/api/v1/contacts/${contact.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      await http()
        .post(`/api/v1/contacts/${contact.id}/restore`)
        .set('Authorization', as('ADMIN'))
        .expect(404);

      const restored = await http()
        .post('/api/v1/trash/restore')
        .set('Authorization', as('ADMIN'))
        .send({ entityType: 'CONTACT', entityId: contact.id })
        .expect(200);
      expect(restored.body.entity).toMatchObject({ type: 'CONTACT', id: contact.id });
      expect(
        await admin.activityLog.count({ where: { action: 'RESTORE', entityType: 'CONTACT' } }),
      ).toBe(1);

      await admin.contact.update({ where: { id: contact.id }, data: { deletedAt: new Date() } });
      await admin.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
      const blocked = await http()
        .post('/api/v1/trash/restore')
        .set('Authorization', as('ADMIN'))
        .send({ entityType: 'CONTACT', entityId: contact.id })
        .expect(409);
      expect(blocked.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'trash.errors.clientArchived',
        entity: { type: 'CLIENT', id: client.id },
      });
    });
  });

  describe('archive and restore (C19)', () => {
    async function clientWithProjectAndContacts() {
      const client = (await createClient('ADMIN', { taxId: 'J-30123456-7' }).expect(201)).body;
      await createContact('ADMIN', client.id, { isPrimary: true }).expect(201);
      await createContact('ADMIN', client.id, { fullName: 'Bruno' }).expect(201);
      const project = await makeProject(admin);
      await admin.project.update({ where: { id: project.id }, data: { status: 'EN_CURSO' } });
      await admin.projectClient.create({ data: { projectId: project.id, clientId: client.id } });
      return client as { id: string };
    }

    it('locks with 409 until confirm, then archives the client and its contacts with one deletedAt', async () => {
      const client = await clientWithProjectAndContacts();
      const locked = await http()
        .post(`/api/v1/clients/${client.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({ confirm: false })
        .expect(409);
      expect(locked.body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'clients.errors.archiveNeedsConfirm',
        entity: { type: 'CLIENT', id: client.id },
      });
      expect(await admin.client.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({
        deletedAt: null,
      });
      await http()
        .post(`/api/v1/clients/${client.id}/archive`)
        .set('Authorization', as('MEMBER'))
        .send({ confirm: true })
        .expect(403);

      const done = await http()
        .post(`/api/v1/clients/${client.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({ confirm: true })
        .expect(200);
      expect(done.body).toMatchObject({ id: client.id, archivedContacts: 2 });
      const row = await admin.client.findUniqueOrThrow({ where: { id: client.id } });
      expect(row.deletedAt?.toISOString()).toBe(done.body.archivedAt);
      const contacts = await admin.contact.findMany({ where: { clientId: client.id } });
      expect(contacts.map((c) => c.deletedAt?.toISOString())).toEqual([
        done.body.archivedAt,
        done.body.archivedAt,
      ]);
      expect(
        await admin.activityLog.count({ where: { action: 'DELETE', entityType: 'CONTACT' } }),
      ).toBe(2);
      expect(
        await admin.searchEntry.count({
          where: { archived: true, entityType: { in: ['CLIENT', 'CONTACT'] } },
        }),
      ).toBe(3);

      // The trash lists the archived client for Owner and Admin only.
      const trash = await http()
        .get('/api/v1/trash')
        .query({ entityType: 'CLIENT' })
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(trash.body.items.map((i: { entity: { id: string } }) => i.entity.id)).toEqual([
        client.id,
      ]);
      await http().get('/api/v1/trash').set('Authorization', as('MEMBER')).expect(403);
    });

    it('archives several clients all or nothing', async () => {
      const locked = await clientWithProjectAndContacts();
      const free = (await createClient('ADMIN', { taxId: 'J-50000000-1' }).expect(201)).body;
      const refused = await http()
        .post('/api/v1/clients/archive')
        .set('Authorization', as('ADMIN'))
        .send({ ids: [free.id, locked.id], confirm: false })
        .expect(409);
      expect(refused.body.error.code).toBe('INTEGRITY_LOCK');
      expect(await admin.client.count({ where: { deletedAt: null } })).toBe(2);

      const ok = await http()
        .post('/api/v1/clients/archive')
        .set('Authorization', as('OWNER'))
        .send({ ids: [free.id, locked.id], confirm: true })
        .expect(200);
      expect(ok.body.archived.map((r: { id: string }) => r.id)).toEqual([free.id, locked.id]);
      await http()
        .post('/api/v1/clients/archive')
        .set('Authorization', as('OWNER'))
        .send({ ids: [], confirm: true })
        .expect(422);
    });

    it('restores with the cascade contacts only, and answers 409 when the tax id was reused', async () => {
      const client = await clientWithProjectAndContacts();
      const alone = (await createContact('ADMIN', client.id, { fullName: 'Sola' }).expect(201))
        .body;
      await http()
        .post(`/api/v1/contacts/${alone.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      await http()
        .post(`/api/v1/clients/${client.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({ confirm: true })
        .expect(200);

      const holder = (
        await createClient('ADMIN', { taxId: 'j301234567', tradeName: 'Nuevo dueño' }).expect(201)
      ).body;
      const direct = await http()
        .post(`/api/v1/clients/${client.id}/restore`)
        .set('Authorization', as('ADMIN'))
        .expect(409);
      expect(direct.body.error).toMatchObject({
        code: 'CONFLICT',
        message: 'clients.errors.restoreTaxIdConflict',
        entity: { type: 'CLIENT', id: holder.id },
      });
      const viaTrash = await http()
        .post('/api/v1/trash/restore')
        .set('Authorization', as('ADMIN'))
        .send({ entityType: 'CLIENT', entityId: client.id })
        .expect(409);
      expect(viaTrash.body.error).toMatchObject({
        message: 'trash.errors.taxIdTaken',
        entity: { id: holder.id },
      });

      await http()
        .post(`/api/v1/clients/${holder.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({ confirm: true })
        .expect(200);
      await http()
        .post(`/api/v1/clients/${client.id}/restore`)
        .set('Authorization', as('MEMBER'))
        .expect(403);
      const restored = await http()
        .post(`/api/v1/clients/${client.id}/restore`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(restored.body.archivedAt).toBeNull();
      expect(restored.body.contacts).toHaveLength(2);
      const stillArchived = await admin.contact.findUniqueOrThrow({ where: { id: alone.id } });
      expect(stillArchived.deletedAt).not.toBeNull();
      expect(
        await admin.activityLog.count({ where: { action: 'RESTORE', entityType: 'CLIENT' } }),
      ).toBe(1);
      await http()
        .post(`/api/v1/clients/${client.id}/restore`)
        .set('Authorization', as('ADMIN'))
        .expect(404);
    });
  });

  describe('list, detail and search', () => {
    it('Owner sees decimal-string money fields; Member and Viewer get null, and money sorts and hasOverdue are 422 (C13)', async () => {
      const a = (
        await createClient('ADMIN', { tradeName: 'Alfa', taxId: 'J-50000000-1' }).expect(201)
      ).body;
      const b = (
        await createClient('ADMIN', { tradeName: 'Beta', taxId: 'J-50000000-2' }).expect(201)
      ).body;
      await admin.clientMetrics.update({
        where: { clientId: a.id },
        data: { invoicedUsd: '120.5', receivableUsd: '80', overdueUsd: '80', projectCount: 2 },
      });

      const owner = await http()
        .get('/api/v1/clients')
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(owner.body.items.map((r: { id: string }) => r.id)).toEqual([a.id, b.id]);
      expect(owner.body.items[0]).toMatchObject({
        totalInvoicedUsd: '120.50',
        receivableUsd: '80.00',
        projectCount: 2,
      });
      expect(owner.body.items[1]).toMatchObject({
        totalInvoicedUsd: '0.00',
        receivableUsd: '0.00',
      });
      const byReceivable = await http()
        .get('/api/v1/clients?sort=receivableUsd:asc')
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(byReceivable.body.items[0].id).toBe(b.id);
      const overdue = await http()
        .get('/api/v1/clients?hasOverdue=true')
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(overdue.body.items.map((r: { id: string }) => r.id)).toEqual([a.id]);

      for (const role of ['MEMBER', 'VIEWER'] as const) {
        const res = await http().get('/api/v1/clients').set('Authorization', as(role)).expect(200);
        expect(res.body.items[0]).toMatchObject({
          totalInvoicedUsd: null,
          receivableUsd: null,
          projectCount: 2,
        });
        const sorted = await http()
          .get('/api/v1/clients?sort=receivableUsd:asc')
          .set('Authorization', as(role))
          .expect(422);
        expect(sorted.body.error.fieldErrors.sort).toEqual(['validation.sort.invalid']);
        const filtered = await http()
          .get('/api/v1/clients?hasOverdue=true')
          .set('Authorization', as(role))
          .expect(422);
        expect(filtered.body.error.fieldErrors.hasOverdue).toEqual(['validation.invalidOption']);
        await http()
          .get('/api/v1/clients?sort=projectCount:desc')
          .set('Authorization', as(role))
          .expect(200);
      }
      await http()
        .get('/api/v1/clients?sort=bogus:asc')
        .set('Authorization', as('OWNER'))
        .expect(422);
    });

    it('filters by status, kind, country and q, and honours archived only for the trash roles', async () => {
      const kairos = (
        await createClient('ADMIN', { tradeName: 'Kairos Studio', taxId: 'J-30123456-7' }).expect(
          201,
        )
      ).body;
      await createClient('ADMIN', {
        tradeName: 'Persona',
        kind: 'PERSONA',
        legalName: null,
        country: 'CO',
        taxId: 'CC 123',
      }).expect(201);
      const gone = (
        await createClient('ADMIN', { tradeName: 'Veredas', taxId: 'J-50000000-9' }).expect(201)
      ).body;
      await http()
        .post(`/api/v1/clients/${gone.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({})
        .expect(200);
      await http()
        .post(`/api/v1/clients/${kairos.id}/status`)
        .set('Authorization', as('ADMIN'))
        .send({ status: 'ACTIVO' })
        .expect(200);

      const ids = async (role: UserRole, qs: string) =>
        (
          (await http().get(`/api/v1/clients?${qs}`).set('Authorization', as(role)).expect(200))
            .body.items as { id: string }[]
        ).map((r) => r.id);
      expect(await ids('MEMBER', 'status=ACTIVO')).toEqual([kairos.id]);
      expect(await ids('MEMBER', 'country=CO')).toHaveLength(1);
      expect(await ids('MEMBER', 'kind=PERSONA&kind=EMPRESA')).toHaveLength(2);
      expect(await ids('MEMBER', 'q=KAIROS')).toEqual([kairos.id]);
      expect(await ids('MEMBER', 'q=30123456')).toEqual([kairos.id]);
      expect(await ids('MEMBER', 'archived=include')).toHaveLength(2);
      expect(await ids('ADMIN', 'archived=include')).toHaveLength(3);
      expect(await ids('OWNER', 'archived=only')).toEqual([gone.id]);
      await http().get('/api/v1/clients?status=NOPE').set('Authorization', as('OWNER')).expect(422);
    });

    it('returns the detail with contacts primary first; archived detail is 404 for Member, visible to Admin', async () => {
      const client = (await createClient('ADMIN').expect(201)).body;
      await createContact('ADMIN', client.id, { fullName: 'Zoe' }).expect(201);
      const ana = (await createContact('ADMIN', client.id, { isPrimary: true }).expect(201)).body;

      const detail = await http()
        .get(`/api/v1/clients/${client.id}`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(detail.body.contacts.map((c: { id: string }) => c.id)[0]).toBe(ana.id);
      expect(detail.body).not.toHaveProperty('financials');
      await http().get('/api/v1/clients/missing').set('Authorization', as('VIEWER')).expect(404);

      await http()
        .post(`/api/v1/clients/${client.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({})
        .expect(200);
      await http()
        .get(`/api/v1/clients/${client.id}`)
        .set('Authorization', as('MEMBER'))
        .expect(404);
      const seen = await http()
        .get(`/api/v1/clients/${client.id}`)
        .set('Authorization', as('ADMIN'))
        .expect(200);
      expect(seen.body.archivedAt).toMatch(/Z$/);
    });

    it('searches clients and contacts as EntityRefs, live rows only, capped at 20', async () => {
      const kairos = (
        await createClient('ADMIN', { tradeName: 'Kairos Studio', taxId: 'J-30123456-7' }).expect(
          201,
        )
      ).body;
      const gone = (
        await createClient('ADMIN', { tradeName: 'Kairos Viejo', taxId: 'J-50000000-9' }).expect(
          201,
        )
      ).body;
      const contact = (
        await createContact('ADMIN', kairos.id, { fullName: 'Ana Kairos' }).expect(201)
      ).body;
      await http()
        .post(`/api/v1/clients/${gone.id}/archive`)
        .set('Authorization', as('ADMIN'))
        .send({})
        .expect(200);

      const clients = await http()
        .get('/api/v1/clients/search?q=kairos')
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(clients.body).toEqual([
        { type: 'CLIENT', id: kairos.id, code: 'CLI-0001', label: 'Kairos Studio' },
      ]);
      const contacts = await http()
        .get(`/api/v1/contacts/search?q=ana&clientId=${kairos.id}`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(contacts.body).toEqual([
        { type: 'CONTACT', id: contact.id, code: null, label: 'Ana Kairos' },
      ]);
      await http()
        .get('/api/v1/clients/search?limit=21')
        .set('Authorization', as('VIEWER'))
        .expect(422);
      await http()
        .get('/api/v1/contacts/search?limit=0')
        .set('Authorization', as('VIEWER'))
        .expect(422);
    });
  });

  describe('tags', () => {
    it('registers the CLIENT and CONTACT resolvers so /tags/assign works and the diff logs names', async () => {
      const client = (await createClient('ADMIN').expect(201)).body;
      const contact = (await createContact('ADMIN', client.id).expect(201)).body;
      const tag = (
        await http()
          .post('/api/v1/tags')
          .set('Authorization', as('ADMIN'))
          .send({ name: 'VIP', color: '#112233' })
          .expect(201)
      ).body;
      for (const [entityType, entityId] of [
        ['CLIENT', client.id],
        ['CONTACT', contact.id],
      ]) {
        const res = await http()
          .post('/api/v1/tags/assign')
          .set('Authorization', as('ADMIN'))
          .send({ entityType, entityId, tagIds: [tag.id] })
          .expect(200);
        expect(res.body.items).toEqual([{ id: tag.id, name: 'VIP', color: '#112233' }]);
      }
      const detail = await http()
        .get(`/api/v1/clients/${client.id}`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(detail.body.tags).toEqual([{ id: tag.id, name: 'VIP', color: '#112233' }]);
      expect(detail.body.contacts[0].tags).toEqual([{ id: tag.id, name: 'VIP', color: '#112233' }]);

      const filtered = await http()
        .get(`/api/v1/clients?tagId=${tag.id}`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(filtered.body.total).toBe(1);
      await http()
        .patch(`/api/v1/clients/${client.id}`)
        .set('Authorization', as('ADMIN'))
        .send(form({ tagIds: [] }))
        .expect(200);
      const update = await admin.activityLog.findFirstOrThrow({
        where: { action: 'UPDATE', entityType: 'CLIENT' },
      });
      expect(update.changes).toEqual({ tagIds: ['VIP', ''] });
    });
  });
});
