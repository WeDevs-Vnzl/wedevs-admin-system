import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOpenApiDocument } from '../../../src/app.setup';
import { DocumentRecordsModule } from '../../../src/modules/documents/document-records.module';
import { MarkExpiredDocuments } from '../../../src/modules/documents/application/use-cases/records/mark-expired-documents.use-case';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import {
  catalogIds,
  seedAccount,
  seedExpense,
  seedInvoice,
  seedPayment,
} from '../../finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1/documents';
const NDA = 'dtyp_nda';
const PRD = 'dtyp_prd';
const LINK_TYPE = 'dtyp_credenciales';

type SeedDb = Parameters<typeof seedAccount>[0];
type Ref = { type: string; id: string; code: string | null; label: string };

describe('documents records (e2e): HU-19, HU-20, DT-141, DT-142', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  const db = prisma as unknown as SeedDb;
  const authenticator = new FakeAuthenticator();
  const storage = new InMemoryFileStorage();
  const clock = new FixedClock('2026-10-30T12:00:00.000Z');
  let app: NestExpressApplication;
  const users = {} as Record<string, CurrentUser>;
  const tokens: Record<string, string> = {};

  async function user(role: UserRole, key: string): Promise<void> {
    const row = await prisma.user.create({
      data: { clerkId: `clerk_${key}`, email: `${key}@example.test`, name: key, role },
    });
    users[key] = { userId: row.id, clerkId: row.clerkId, role, email: row.email, name: row.name };
    tokens[key] = authenticator.issue(users[key]);
  }

  beforeAll(async () => {
    app = await createTestApp({
      modules: [DocumentRecordsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FILE_STORAGE, useValue: storage },
        { token: CLOCK, useValue: clock },
      ],
    });
  });
  beforeEach(async () => {
    clock.set('2026-10-30T12:00:00.000Z');
    await truncateBusinessTables(prisma);
    await user('OWNER', 'owner');
    await user('ADMIN', 'admin');
    await user('MEMBER', 'member');
    await user('VIEWER', 'viewer');
    await prisma.client.createMany({
      data: ['cli_k', 'cli_s'].map((id, index) => ({
        id,
        code: `CLI-000${index + 1}`,
        kind: 'EMPRESA' as const,
        tradeName: id === 'cli_k' ? 'Kairos' : 'Solaris',
        legalName: `${id} SA`,
        taxId: id,
        country: 'VE',
        address: 'x',
        phone: '1',
      })),
    });
    for (const [id, code, name] of [
      ['pry_1', 'PRY-0001', 'Kairos Web'],
      ['pry_2', 'PRY-0002', 'Kairos App'],
    ] as const) {
      await prisma.project.create({
        data: { id, code, name, summary: 's', clients: { create: [{ clientId: 'cli_k' }] } },
      });
    }
    await prisma.contact.create({
      data: { id: 'con_1', clientId: 'cli_k', fullName: 'Ana Pérez' },
    });
    await seedAccount(db, 'acc_usd');
    const catalog = await catalogIds(db);
    await seedInvoice(db, {
      id: 'inv_1',
      clientId: 'cli_k',
      lines: [{ id: 'lin_1', projectId: 'pry_1', unitPrice: '100.00', ivaRate: '16' }],
    });
    await seedPayment(db, {
      id: 'pay_1',
      clientId: 'cli_k',
      accountId: 'acc_usd',
      methodId: catalog.methodId,
      amount: '50.00',
    });
    await seedExpense(db, { id: 'exp_1', categoryId: catalog.categoryId, amount: '10.00' });
  });
  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const as = (key: string) => `Bearer ${tokens[key]}`;
  const get = (path: string, key: string) => http().get(path).set('Authorization', as(key));
  const post = (path: string, key: string, body: unknown = {}) =>
    http()
      .post(path)
      .set('Authorization', as(key))
      .send(body as object);
  const patch = (path: string, key: string, body: unknown) =>
    http()
      .patch(path)
      .set('Authorization', as(key))
      .send(body as object);
  const del = (path: string, key: string) => http().delete(path).set('Authorization', as(key));

  const CLIENT = { entityType: 'CLIENT', entityId: 'cli_k' };
  const create = (key: string, over: Record<string, unknown> = {}) =>
    post(BASE, key, {
      title: 'NDA con Kairos',
      typeId: NDA,
      summary: 'Acuerdo de confidencialidad',
      effectiveDate: '2026-10-01',
      expiresAt: '2027-10-01',
      links: [CLIENT],
      ...over,
    });
  const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
  const types = (refs: Ref[]) => refs.map((r) => r.type);

  it('requires authentication on every route', async () => {
    await http().get(BASE).expect(401);
    await http().get(`${BASE}/category-counts`).expect(401);
    await http().post(BASE).send({}).expect(401);
    await http()
      .post(`${BASE}/archive`)
      .send({ ids: ['x'] })
      .expect(401);
    await http().get(`${BASE}/x`).expect(401);
    await http().patch(`${BASE}/x`).send({}).expect(401);
    for (const action of ['status', 'archive', 'restore', 'links']) {
      await http().post(`${BASE}/x/${action}`).send({}).expect(401);
    }
    await http().delete(`${BASE}/x/links/CLIENT/y`).expect(401);
  });

  describe('HU-20 CA1: a document linked to a client, two projects and one record of each other type', () => {
    async function nda() {
      const res = await create('owner', {
        links: [
          CLIENT,
          { entityType: 'PROJECT', entityId: 'pry_1' },
          { entityType: 'PROJECT', entityId: 'pry_2' },
          { entityType: 'CONTACT', entityId: 'con_1' },
          { entityType: 'INVOICE', entityId: 'inv_1' },
          { entityType: 'PAYMENT', entityId: 'pay_1' },
          { entityType: 'EXPENSE', entityId: 'exp_1' },
        ],
      }).expect(201);
      return res.body as { id: string; links: { id: string; entity: Ref }[] };
    }

    it('creates it with the DOC code, the type and category refs and the seven resolved links', async () => {
      const res = await create('owner', {
        links: [
          CLIENT,
          { entityType: 'PROJECT', entityId: 'pry_1' },
          { entityType: 'PROJECT', entityId: 'pry_2' },
          { entityType: 'CONTACT', entityId: 'con_1' },
          { entityType: 'INVOICE', entityId: 'inv_1' },
          { entityType: 'PAYMENT', entityId: 'pay_1' },
          { entityType: 'EXPENSE', entityId: 'exp_1' },
        ],
      }).expect(201);

      expect(res.body).toMatchObject({
        code: 'DOC-0001',
        title: 'NDA con Kairos',
        status: 'BORRADOR',
        summary: 'Acuerdo de confidencialidad',
        effectiveDate: '2026-10-01',
        expiresAt: '2027-10-01',
        signedAt: null,
        alertDaysBefore: 30,
        currentVersion: null,
        versionCount: 0,
        isShared: false,
        archivedAt: null,
        createdBy: { id: users.owner?.userId, name: 'owner' },
        type: { id: NDA, requiresSignature: true, hasExpiration: true, defaultFormat: 'ARCHIVO' },
        category: { id: 'dcat_legal', name: 'Legal' },
      });
      expect(types(res.body.links.map((l: { entity: Ref }) => l.entity))).toEqual([
        'CLIENT',
        'PROJECT',
        'PROJECT',
        'CONTACT',
        'INVOICE',
        'PAYMENT',
        'EXPENSE',
      ]);
      expect(res.body.links[0].entity).toMatchObject({
        id: 'cli_k',
        code: 'CLI-0001',
        label: 'Kairos',
      });
      expect(res.body.links[3].entity).toMatchObject({
        id: 'con_1',
        code: null,
        label: 'Ana Pérez',
      });
      expect(res.body.links[0].createdAt).toMatch(/Z$/);
    });

    it('lists it under each of the six link facets, in the table row with its chips', async () => {
      const { id } = await nda();
      await create('owner', {
        title: 'Otro',
        links: [{ entityType: 'CLIENT', entityId: 'cli_s' }],
      }).expect(201);
      for (const facet of [
        'clientId=cli_k',
        'projectId=pry_1',
        'projectId=pry_2',
        'contactId=con_1',
        'invoiceId=inv_1',
        'paymentId=pay_1',
        'expenseId=exp_1',
      ]) {
        expect(ids(await get(`${BASE}?${facet}`, 'owner').expect(200)), facet).toEqual([id]);
      }
      expect(
        ids(await get(`${BASE}?clientId=cli_k&projectId=pry_1&expenseId=exp_1`, 'owner')),
      ).toEqual([id]);
      expect(ids(await get(`${BASE}?clientId=cli_x`, 'owner'))).toEqual([]);

      const row = (await get(`${BASE}?clientId=cli_k`, 'owner').expect(200)).body.items[0];
      expect(row).toMatchObject({
        id,
        code: 'DOC-0001',
        currentFormat: null,
        currentVersionNumber: null,
        isShared: false,
        category: { id: 'dcat_legal' },
        type: { id: NDA },
      });
      expect(types(row.links)).toHaveLength(7);
    });

    it("records CREATE and one LINK per record with the client scope, touching the client's activity", async () => {
      const { id } = await nda();
      const log = await prisma.activityLog.findMany({
        where: { entityType: 'DOCUMENT', entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(log.map((l) => l.action)).toEqual(['CREATE', ...Array<string>(7).fill('LINK')]);
      expect(log.every((l) => l.clientId === 'cli_k' && l.actorId === users.owner?.userId)).toBe(
        true,
      );
      expect(log[3]?.metadata).toEqual({ entityType: 'PROJECT', entityId: 'pry_2' });
      const metrics = await prisma.clientMetrics.findUniqueOrThrow({
        where: { clientId: 'cli_k' },
      });
      expect(metrics.lastActivityAt).not.toBeNull();
    });

    it('HU-20 CA2: unlinking one record keeps the others and the document, and logs UNLINK', async () => {
      const { id } = await nda();

      const res = await del(`${BASE}/${id}/links/PROJECT/pry_2`, 'member').expect(200);

      expect(types(res.body.map((l: { entity: Ref }) => l.entity))).toEqual([
        'CLIENT',
        'PROJECT',
        'CONTACT',
      ]);
      const row = await prisma.document.findUniqueOrThrow({ where: { id } });
      expect(row.deletedAt).toBeNull();
      expect(await prisma.documentLink.count({ where: { documentId: id } })).toBe(6);
      const unlink = await prisma.activityLog.findFirstOrThrow({
        where: { entityId: id, action: 'UNLINK' },
      });
      expect(unlink).toMatchObject({
        metadata: { entityType: 'PROJECT', entityId: 'pry_2' },
        clientId: 'cli_k',
      });
      // Unlinking again changes nothing and writes no second entry.
      await del(`${BASE}/${id}/links/PROJECT/pry_2`, 'member').expect(200);
      expect(await prisma.activityLog.count({ where: { entityId: id, action: 'UNLINK' } })).toBe(1);
    });

    it('link is idempotent: a repeated target leaves one row and one entry', async () => {
      const { id } = await nda();
      const target = { entityType: 'CONTACT', entityId: 'con_1' };
      const before = await prisma.activityLog.count({ where: { entityId: id, action: 'LINK' } });
      const again = await post(`${BASE}/${id}/links`, 'owner', target).expect(201);
      expect(again.body).toHaveLength(7);
      expect(
        await prisma.documentLink.count({ where: { documentId: id, contactId: 'con_1' } }),
      ).toBe(1);
      expect(await prisma.activityLog.count({ where: { entityId: id, action: 'LINK' } })).toBe(
        before,
      );

      const fresh = await create('owner', { links: [] }).expect(201);
      const first = await post(`${BASE}/${fresh.body.id}/links`, 'member', target).expect(201);
      expect(first.body).toHaveLength(1);
      expect(
        await prisma.activityLog.count({ where: { entityId: fresh.body.id, action: 'LINK' } }),
      ).toBe(1);
    });

    it('answers NOT_FOUND for unknown or archived records, and VALIDATION for DOCUMENT as a target', async () => {
      const { id } = await nda();
      await post(`${BASE}/${id}/links`, 'owner', {
        entityType: 'CLIENT',
        entityId: 'cli_missing',
      }).expect(404);
      await prisma.client.update({ where: { id: 'cli_s' }, data: { deletedAt: new Date() } });
      await post(`${BASE}/${id}/links`, 'owner', {
        entityType: 'CLIENT',
        entityId: 'cli_s',
      }).expect(404);
      const refused = await post(`${BASE}/${id}/links`, 'owner', {
        entityType: 'DOCUMENT',
        entityId: id,
      }).expect(422);
      expect(refused.body.error.code).toBe('VALIDATION');
      await post(`${BASE}/missing/links`, 'owner', CLIENT).expect(404);
    });
  });

  describe('the three formats', () => {
    it('creates a markdown document with no version, a file document and a link document', async () => {
      const markdown = await create('member', {
        typeId: PRD,
        expiresAt: undefined,
        links: [],
      }).expect(201);
      expect(markdown.body).toMatchObject({
        status: 'BORRADOR',
        currentVersion: null,
        type: { defaultFormat: 'MARKDOWN' },
      });

      await prisma.file.create({
        data: {
          id: 'fil_a',
          storageKey: 'general/2026/10/secret-key',
          bucket: 'private-bucket',
          originalName: 'nda.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          status: 'READY',
          uploadedById: users.member?.userId ?? '',
        },
      });
      const file = await create('member', {
        initialVersion: { format: 'ARCHIVO', fileId: 'fil_a', changelog: 'Firmado' },
      }).expect(201);
      expect(file.body.currentVersion).toMatchObject({
        versionNumber: 1,
        format: 'ARCHIVO',
        changelog: 'Firmado',
        isCurrent: true,
        content: null,
        url: null,
        file: {
          id: 'fil_a',
          originalName: 'nda.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          status: 'READY',
        },
      });
      expect(JSON.stringify(file.body)).not.toContain('secret-key');
      expect(JSON.stringify(file.body)).not.toContain('private-bucket');
      expect(file.body.versionCount).toBe(1);
      const upload = await prisma.activityLog.findFirstOrThrow({
        where: { entityId: file.body.id, action: 'UPLOAD' },
      });
      expect(upload.metadata).toEqual({ versionNumber: 1, format: 'ARCHIVO' });

      const link = await create('member', {
        typeId: LINK_TYPE,
        expiresAt: undefined,
        initialVersion: { format: 'ENLACE', url: 'https://vault.example.com/item/1' },
      }).expect(201);
      expect(link.body.currentVersion).toMatchObject({
        format: 'ENLACE',
        url: 'https://vault.example.com/item/1',
        file: null,
      });
      expect(
        await prisma.activityLog.count({
          where: { entityId: link.body.id, action: 'VERSION_PUBLISH' },
        }),
      ).toBe(1);

      const row = (await get(`${BASE}?typeId=${NDA}`, 'owner').expect(200)).body.items[0];
      expect(row).toMatchObject({ currentFormat: 'ARCHIVO', currentVersionNumber: 1 });
    });

    it('creates all or nothing: a bad URL, a missing file or a file a version holds leaves nothing behind', async () => {
      const count = () => prisma.document.count();
      const bad = await create('member', {
        typeId: LINK_TYPE,
        expiresAt: undefined,
        initialVersion: { format: 'ENLACE', url: 'javascript:alert(1)' },
      }).expect(422);
      expect(bad.body.error.fieldErrors).toEqual({ url: ['validation.invalidFormat'] });
      await create('member', {
        initialVersion: { format: 'ARCHIVO', fileId: 'fil_missing' },
      }).expect(404);
      expect(await count()).toBe(0);
      expect(await prisma.activityLog.count()).toBe(0);
      expect(await prisma.searchEntry.count()).toBe(0);

      await prisma.file.create({
        data: {
          id: 'fil_a',
          storageKey: 'k',
          bucket: 'b',
          originalName: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          status: 'READY',
          uploadedById: users.member?.userId ?? '',
        },
      });
      await create('member', { initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }).expect(
        201,
      );
      await create('member', { initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }).expect(
        409,
      );
      expect(await count()).toBe(1);
      // The code of the refused attempts was not consumed.
      expect((await create('member', { links: [] }).expect(201)).body.code).toBe('DOC-0002');
    });

    it('applies the type rules with the same keys the FE ships', async () => {
      const signed = await create('member', {
        typeId: PRD,
        signedAt: '2026-10-08',
        expiresAt: undefined,
      }).expect(422);
      expect(signed.body.error.fieldErrors).toEqual({
        signedAt: ['documents.validation.signedAtNotAllowed'],
      });
      const expiry = await create('member', { typeId: PRD }).expect(422);
      expect(expiry.body.error.fieldErrors).toEqual({
        expiresAt: ['documents.validation.expiresAtNotAllowed'],
      });
      const dates = await create('member', { effectiveDate: '2027-12-01' }).expect(422);
      expect(dates.body.error.fieldErrors).toEqual({ expiresAt: ['validation.date.invalid'] });
      await create('member', { typeId: 'dtyp_missing' }).expect(404);
      await prisma.documentType.update({ where: { id: PRD }, data: { active: false } });
      const inactive = await create('member', { typeId: PRD, expiresAt: undefined }).expect(422);
      expect(inactive.body.error.fieldErrors).toEqual({ typeId: ['validation.invalidOption'] });
      await prisma.documentType.update({ where: { id: PRD }, data: { active: true } });
    });

    it('rejects a malformed body as VALIDATION before any use case runs', async () => {
      for (const over of [
        { title: '   ' },
        { alertDaysBefore: 400 },
        { links: 'x' },
        { typeId: '' },
      ]) {
        expect((await create('member', over).expect(422)).body.error.code).toBe('VALIDATION');
      }
      expect(await prisma.document.count()).toBe(0);
    });
  });

  describe('HU-19 CA1: statuses and the signature', () => {
    async function sendable(key = 'member') {
      const { id } = (await create(key).expect(201)).body;
      for (const status of ['EN_REVISION', 'APROBADO', 'ENVIADO']) {
        await post(`${BASE}/${id}/status`, key, { status }).expect(200);
      }
      return id as string;
    }

    it('walks the transitions, requires the signature date for FIRMADO and stores it', async () => {
      const { id } = (await create('member').expect(201)).body;
      const res = await post(`${BASE}/${id}/status`, 'member', { status: 'EN_REVISION' }).expect(
        200,
      );
      expect(res.body.status).toBe('EN_REVISION');
      expect(
        (
          await prisma.activityLog.findFirstOrThrow({
            where: { entityId: id, action: 'STATUS_CHANGE' },
          })
        ).changes,
      ).toEqual({ status: ['BORRADOR', 'EN_REVISION'] });

      await post(`${BASE}/${id}/status`, 'member', { status: 'APROBADO' }).expect(200);
      await post(`${BASE}/${id}/status`, 'member', { status: 'ENVIADO' }).expect(200);
      const missing = await post(`${BASE}/${id}/status`, 'member', { status: 'FIRMADO' }).expect(
        422,
      );
      expect(missing.body.error.fieldErrors).toEqual({ signedAt: ['validation.required'] });

      const signed = await post(`${BASE}/${id}/status`, 'member', {
        status: 'FIRMADO',
        signedAt: '2026-10-08',
      }).expect(200);
      expect(signed.body).toMatchObject({ status: 'FIRMADO', signedAt: '2026-10-08' });
      expect(
        (await prisma.document.findUniqueOrThrow({ where: { id } })).signedAt?.toISOString(),
      ).toBe('2026-10-08T00:00:00.000Z');
      expect(
        (
          await prisma.searchEntry.findFirstOrThrow({
            where: { entityType: 'DOCUMENT', entityId: id },
          })
        ).status,
      ).toBe('FIRMADO');
    });

    it('refuses a transition the table does not allow, VENCIDO, and FIRMADO on a type without signature', async () => {
      const { id } = (await create('member').expect(201)).body;
      const jump = await post(`${BASE}/${id}/status`, 'member', { status: 'ENVIADO' }).expect(422);
      expect(jump.body.error.fieldErrors).toEqual({
        status: ['documents.errors.invalidTransition'],
      });
      await post(`${BASE}/${id}/status`, 'member', { status: 'VENCIDO' }).expect(422);

      const plain = (
        await create('member', { typeId: PRD, expiresAt: undefined, links: [] }).expect(201)
      ).body.id;
      for (const status of ['EN_REVISION', 'APROBADO', 'ENVIADO']) {
        await post(`${BASE}/${plain}/status`, 'member', { status }).expect(200);
      }
      const noSignature = await post(`${BASE}/${plain}/status`, 'member', {
        status: 'FIRMADO',
        signedAt: '2026-10-08',
      }).expect(422);
      expect(noSignature.body.error.fieldErrors).toEqual({
        signedAt: ['documents.validation.signedAtNotAllowed'],
        status: ['documents.validation.signedStatusNotAllowed'],
      });
    });

    it('updates the metadata: UPDATE with the changed fields, type rules and the signed lock', async () => {
      const id = await sendable();
      const res = await patch(`${BASE}/${id}`, 'member', {
        title: 'NDA revisado',
        typeId: NDA,
        summary: 'Acuerdo de confidencialidad',
        effectiveDate: '2026-10-01',
        expiresAt: '2027-10-01',
        alertDaysBefore: 10,
        tagIds: [],
      }).expect(200);
      expect(res.body).toMatchObject({ title: 'NDA revisado', alertDaysBefore: 10 });
      const entry = await prisma.activityLog.findFirstOrThrow({
        where: { entityId: id, action: 'UPDATE' },
      });
      expect(entry.changes).toEqual({
        title: ['NDA con Kairos', 'NDA revisado'],
        alertDaysBefore: ['30', '10'],
      });

      await post(`${BASE}/${id}/status`, 'member', {
        status: 'FIRMADO',
        signedAt: '2026-10-08',
      }).expect(200);
      const lost = await patch(`${BASE}/${id}`, 'member', {
        title: 'NDA revisado',
        typeId: NDA,
        effectiveDate: '2026-10-01',
        expiresAt: '2027-10-01',
        alertDaysBefore: 10,
      }).expect(422);
      expect(lost.body.error.fieldErrors).toEqual({ signedAt: ['validation.required'] });
      const retyped = await patch(`${BASE}/${id}`, 'member', {
        title: 'x',
        typeId: PRD,
        signedAt: '2026-10-08',
        alertDaysBefore: 10,
      }).expect(422);
      expect(retyped.body.error.fieldErrors.signedAt).toEqual([
        'documents.validation.signedAtNotAllowed',
      ]);
    });
  });

  describe('HU-19 CA3: the expiry step', () => {
    it('marks an expired document VENCIDO once, logs SYSTEM_JOB and reindexes (FixedClock, Caracas day)', async () => {
      const step = app.get(MarkExpiredDocuments, { strict: false });
      const { id } = (await create('member', { expiresAt: '2026-11-15' }).expect(201)).body;
      const other = (
        await create('member', { title: 'Sin fecha', typeId: PRD, expiresAt: undefined }).expect(
          201,
        )
      ).body.id;

      clock.set('2026-11-16T03:00:00.000Z'); // still 2026-11-15 in Caracas
      expect((await step.execute({ actorType: 'SYSTEM', userId: null })).updated).toBe(0);

      clock.set('2026-11-16T12:00:00.000Z');
      const result = await step.execute({ actorType: 'SYSTEM', userId: null });
      expect(result).toEqual({ updated: 1, documentIds: [id], skippedIds: [] });

      expect((await get(`${BASE}/${id}`, 'viewer').expect(200)).body.status).toBe('VENCIDO');
      expect((await get(`${BASE}/${other}`, 'viewer').expect(200)).body.status).toBe('BORRADOR');
      const job = await prisma.activityLog.findFirstOrThrow({
        where: { entityId: id, action: 'SYSTEM_JOB' },
      });
      expect(job).toMatchObject({
        actorType: 'SYSTEM',
        actorId: null,
        clientId: 'cli_k',
        metadata: { from: 'BORRADOR', to: 'VENCIDO' },
      });
      expect(
        (
          await prisma.searchEntry.findFirstOrThrow({
            where: { entityType: 'DOCUMENT', entityId: id },
          })
        ).status,
      ).toBe('VENCIDO');

      expect((await step.execute({ actorType: 'SYSTEM', userId: null })).updated).toBe(0);
      expect(await prisma.activityLog.count({ where: { action: 'SYSTEM_JOB' } })).toBe(1);
      await post(`${BASE}/${id}/status`, 'owner', { status: 'ANULADO' }).expect(422);
    });
  });

  describe('roles: Member CRU, Viewer R, archive for Owner and Admin (PRD §4.3)', () => {
    it('a Viewer reads but gets FORBIDDEN on every write', async () => {
      const { id } = (await create('owner').expect(201)).body;
      await get(BASE, 'viewer').expect(200);
      await get(`${BASE}/${id}`, 'viewer').expect(200);
      await get(`${BASE}/category-counts`, 'viewer').expect(200);
      const writes = [
        () => create('viewer'),
        () => patch(`${BASE}/${id}`, 'viewer', { title: 'x', typeId: NDA, alertDaysBefore: 1 }),
        () => post(`${BASE}/${id}/status`, 'viewer', { status: 'EN_REVISION' }),
        () => post(`${BASE}/${id}/archive`, 'viewer'),
        () => post(`${BASE}/archive`, 'viewer', { ids: [id] }),
        () => post(`${BASE}/${id}/restore`, 'viewer'),
        () => post(`${BASE}/${id}/links`, 'viewer', { entityType: 'CONTACT', entityId: 'con_1' }),
        () => del(`${BASE}/${id}/links/CLIENT/cli_k`, 'viewer'),
      ];
      for (const write of writes) {
        const res = await write().expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(await prisma.document.count()).toBe(1);
      expect((await prisma.document.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
    });

    it('a Member creates and edits but cannot archive or restore', async () => {
      const { id } = (await create('member').expect(201)).body;
      await post(`${BASE}/${id}/archive`, 'member').expect(403);
      await post(`${BASE}/archive`, 'member', { ids: [id] }).expect(403);
      await post(`${BASE}/${id}/archive`, 'admin').expect(200);
      await post(`${BASE}/${id}/restore`, 'member').expect(403);
    });

    it('DT-142: a Member cannot link, filter by or see financial records', async () => {
      const { id } = (
        await create('owner', {
          links: [
            CLIENT,
            { entityType: 'INVOICE', entityId: 'inv_1' },
            { entityType: 'EXPENSE', entityId: 'exp_1' },
          ],
        }).expect(201)
      ).body;

      for (const type of ['INVOICE', 'PAYMENT', 'EXPENSE']) {
        const entityId = { INVOICE: 'inv_1', PAYMENT: 'pay_1', EXPENSE: 'exp_1' }[type];
        await create('member', { links: [{ entityType: type, entityId }] }).expect(404);
        await post(`${BASE}/${id}/links`, 'member', { entityType: type, entityId }).expect(404);
        await del(`${BASE}/${id}/links/${type}/${entityId}`, 'member').expect(404);
      }
      for (const facet of ['invoiceId=inv_1', 'paymentId=pay_1', 'expenseId=exp_1']) {
        await get(`${BASE}?${facet}`, 'member').expect(404);
        await get(`${BASE}/category-counts?${facet}`, 'viewer').expect(404);
      }
      expect(await prisma.documentLink.count({ where: { documentId: id } })).toBe(3);

      for (const key of ['member', 'viewer']) {
        const detail = (await get(`${BASE}/${id}`, key).expect(200)).body;
        expect(types(detail.links.map((l: { entity: Ref }) => l.entity))).toEqual(['CLIENT']);
        const row = (await get(BASE, key).expect(200)).body.items[0];
        expect(types(row.links)).toEqual(['CLIENT']);
      }
      clock.advance(60_000); // the frozen clock would tie the new link with the first one
      const mutated = await post(`${BASE}/${id}/links`, 'member', {
        entityType: 'CONTACT',
        entityId: 'con_1',
      }).expect(201);
      expect(types(mutated.body.map((l: { entity: Ref }) => l.entity))).toEqual([
        'CLIENT',
        'CONTACT',
      ]);
      const admin = (await get(`${BASE}/${id}`, 'admin').expect(200)).body;
      expect(types(admin.links.map((l: { entity: Ref }) => l.entity))).toEqual([
        'CLIENT',
        'INVOICE',
        'EXPENSE',
        'CONTACT',
      ]);
    });
  });

  describe('lists, search and counts', () => {
    it('filters, sorts and searches over SearchEntry (code, title, type name, summary), accent-insensitive', async () => {
      await prisma.tag.create({ data: { id: 'tag_u', name: 'Urgente', color: '#112233' } });
      const a = (await create('member', { title: 'Acuerdo Kairos', tagIds: ['tag_u'] }).expect(201))
        .body;
      const b = (
        await create('member', {
          title: 'Arquitectura',
          typeId: PRD,
          expiresAt: undefined,
          summary: 'Diseño técnico',
          links: [],
        }).expect(201)
      ).body;
      const c = (
        await create('member', {
          title: 'Cotización mayo',
          typeId: 'dtyp_cotizacion',
          summary: undefined,
          expiresAt: '2026-11-01',
          links: [{ entityType: 'CLIENT', entityId: 'cli_s' }],
        }).expect(201)
      ).body;
      await post(`${BASE}/${a.id}/status`, 'member', { status: 'EN_REVISION' }).expect(200);

      expect(ids(await get(`${BASE}?q=doc-0002`, 'viewer'))).toEqual([b.id]);
      expect(ids(await get(`${BASE}?q=TECNICO`, 'viewer'))).toEqual([b.id]);
      expect(ids(await get(`${BASE}?q=cotizacion`, 'viewer'))).toEqual([c.id]);
      expect(ids(await get(`${BASE}?q=confidencialidad`, 'viewer'))).toEqual([a.id]);
      expect(ids(await get(`${BASE}?q=nda`, 'viewer'))).toEqual([a.id]);
      expect(ids(await get(`${BASE}?q=nada`, 'viewer'))).toEqual([]);
      expect(ids(await get(`${BASE}?status=EN_REVISION`, 'viewer'))).toEqual([a.id]);
      expect(ids(await get(`${BASE}?tagId=tag_u`, 'viewer'))).toEqual([a.id]);
      expect(ids(await get(`${BASE}?categoryId=dcat_tecnico`, 'viewer'))).toEqual([b.id]);
      expect(ids(await get(`${BASE}?typeId=${NDA}&typeId=${PRD}`, 'viewer')).sort()).toEqual(
        [a.id, b.id].sort(),
      );
      expect(ids(await get(`${BASE}?expiresFrom=2027-01-01`, 'viewer'))).toEqual([a.id]);
      expect(ids(await get(`${BASE}?sort=code:desc`, 'viewer'))).toEqual([c.id, b.id, a.id]);
      expect(ids(await get(`${BASE}?sort=title:asc`, 'viewer'))).toEqual([a.id, b.id, c.id]);
      const page = (await get(`${BASE}?pageSize=25&page=1`, 'viewer').expect(200)).body;
      expect(page).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
      expect(page.items.find((r: { id: string }) => r.id === a.id).tags).toEqual([
        { id: 'tag_u', name: 'Urgente', color: '#112233' },
      ]);

      await get(`${BASE}?status=NOPE`, 'viewer').expect(422);
      await get(`${BASE}?sort=nope:asc`, 'viewer').expect(422);
      await get(`${BASE}?shared=maybe`, 'viewer').expect(422);
      await get(`${BASE}?expiringWithinDays=0`, 'viewer').expect(422);
    });

    it('applies the overview shortcuts: expiring within N days and stale drafts', async () => {
      const soon = (await create('member', { expiresAt: '2026-11-15' }).expect(201)).body;
      await create('member', { expiresAt: '2027-06-01', title: 'Lejos' }).expect(201);
      expect(ids(await get(`${BASE}?expiringWithinDays=30`, 'viewer'))).toEqual([soon.id]);
      expect(ids(await get(`${BASE}?expiringWithinDays=10`, 'viewer'))).toEqual([]);
      expect(ids(await get(`${BASE}?staleDraft=true`, 'viewer'))).toEqual([]);
      await prisma.document.updateMany({
        data: { updatedAt: new Date('2026-10-01T00:00:00.000Z') },
      });
      expect((await get(`${BASE}?staleDraft=true`, 'viewer')).body.total).toBe(2);
    });

    it('counts live documents per category under the other facets', async () => {
      await create('member').expect(201);
      await create('member', { typeId: PRD, expiresAt: undefined, links: [] }).expect(201);
      const archived = (
        await create('member', {
          typeId: PRD,
          expiresAt: undefined,
          title: 'Viejo',
          links: [],
        }).expect(201)
      ).body;
      await post(`${BASE}/${archived.id}/archive`, 'admin').expect(200);

      expect((await get(`${BASE}/category-counts`, 'viewer').expect(200)).body).toEqual({
        dcat_legal: 1,
        dcat_tecnico: 1,
      });
      expect(
        (await get(`${BASE}/category-counts?categoryId=dcat_legal&clientId=cli_k`, 'viewer')).body,
      ).toEqual({ dcat_legal: 1 });
      expect((await get(`${BASE}/category-counts?q=viejo`, 'viewer')).body).toEqual({});
    });

    it('shows archived documents to the trash roles only', async () => {
      const { id } = (await create('member').expect(201)).body;
      await post(`${BASE}/${id}/archive`, 'admin').expect(200);
      expect(ids(await get(BASE, 'owner'))).toEqual([]);
      expect(ids(await get(`${BASE}?archived=only`, 'owner'))).toEqual([id]);
      expect(ids(await get(`${BASE}?archived=include`, 'member'))).toEqual([]);
      expect((await get(`${BASE}/${id}`, 'owner').expect(200)).body.archivedAt).not.toBeNull();
      await get(`${BASE}/${id}`, 'member').expect(404);
      await get(`${BASE}/${id}`, 'viewer').expect(404);
    });
  });

  describe('archive, restore and the trash (HU-28)', () => {
    it('archives, shows in the trash and restores through it, reindexing both ways', async () => {
      const { id } = (await create('member').expect(201)).body;
      const archived = await post(`${BASE}/${id}/archive`, 'admin').expect(200);
      expect(archived.body).toMatchObject({ id });
      expect(archived.body.archivedAt).toMatch(/Z$/);
      expect(
        (
          await prisma.searchEntry.findFirstOrThrow({
            where: { entityType: 'DOCUMENT', entityId: id },
          })
        ).archived,
      ).toBe(true);
      expect(await prisma.activityLog.count({ where: { entityId: id, action: 'DELETE' } })).toBe(1);
      await post(`${BASE}/${id}/archive`, 'admin').expect(404);
      await post(`${BASE}/${id}/status`, 'admin', { status: 'EN_REVISION' }).expect(404);

      const trash = await get('/api/v1/trash?entityType=DOCUMENT', 'admin').expect(200);
      expect(trash.body.items).toHaveLength(1);
      expect(trash.body.items[0]).toMatchObject({
        entity: { type: 'DOCUMENT', id, code: 'DOC-0001', label: 'NDA con Kairos' },
        context: 'Acuerdo de confidencialidad (NDA)',
      });

      const restored = await post('/api/v1/trash/restore', 'admin', {
        entityType: 'DOCUMENT',
        entityId: id,
      }).expect(200);
      expect(restored.body.entity).toMatchObject({ type: 'DOCUMENT', id });
      expect((await get(`${BASE}/${id}`, 'viewer').expect(200)).body.archivedAt).toBeNull();
      expect(
        (
          await prisma.searchEntry.findFirstOrThrow({
            where: { entityType: 'DOCUMENT', entityId: id },
          })
        ).archived,
      ).toBe(false);
      expect(await prisma.activityLog.count({ where: { entityId: id, action: 'RESTORE' } })).toBe(
        1,
      );
      await post(`${BASE}/${id}/restore`, 'admin').expect(404);
      expect(ids(await get(BASE, 'viewer'))).toEqual([id]);
    });

    it('restores by its own route too, and a Member does not see the trash', async () => {
      const { id } = (await create('member').expect(201)).body;
      await post(`${BASE}/${id}/archive`, 'owner').expect(200);
      await get('/api/v1/trash', 'member').expect(403);
      const res = await post(`${BASE}/${id}/restore`, 'owner').expect(200);
      expect(res.body).toEqual({ type: 'DOCUMENT', id, code: 'DOC-0001', label: 'NDA con Kairos' });
    });

    it('archives a selection all or nothing', async () => {
      const a = (await create('member').expect(201)).body.id;
      const b = (await create('member', { title: 'B' }).expect(201)).body.id;
      await post(`${BASE}/archive`, 'admin', { ids: [a, 'doc_missing'] }).expect(404);
      expect(await prisma.document.count({ where: { deletedAt: { not: null } } })).toBe(0);
      const res = await post(`${BASE}/archive`, 'admin', { ids: [a, b, a] }).expect(200);
      expect(res.body.archived.map((r: { id: string }) => r.id)).toEqual([a, b]);
      expect(await prisma.document.count({ where: { deletedAt: { not: null } } })).toBe(2);
      await post(`${BASE}/archive`, 'admin', { ids: [] }).expect(422);
    });
  });

  describe('tags and notes', () => {
    it("lets settings' tag endpoints tag a document the caller may update, with the client scope", async () => {
      await prisma.tag.create({ data: { id: 'tag_u', name: 'Urgente', color: '#112233' } });
      const { id } = (await create('member').expect(201)).body;
      await post('/api/v1/tags/assign', 'viewer', {
        entityType: 'DOCUMENT',
        entityId: id,
        tagIds: ['tag_u'],
      }).expect(403);
      const res = await post('/api/v1/tags/assign', 'member', {
        entityType: 'DOCUMENT',
        entityId: id,
        tagIds: ['tag_u'],
      }).expect(200);
      expect(res.body.items).toEqual([{ id: 'tag_u', name: 'Urgente', color: '#112233' }]);
      const entry = await prisma.activityLog.findFirstOrThrow({
        where: {
          entityId: id,
          action: 'LINK',
          entityType: 'DOCUMENT',
          metadata: { path: ['tagId'], equals: 'tag_u' },
        },
      });
      expect(entry.clientId).toBe('cli_k');
      expect((await get(`${BASE}/${id}`, 'viewer')).body.tags).toHaveLength(1);

      await post(`${BASE}/${id}/archive`, 'admin').expect(200);
      await post('/api/v1/tags/assign', 'member', {
        entityType: 'DOCUMENT',
        entityId: id,
        tagIds: ['tag_u'],
      }).expect(404);
    });

    it('lets a note hang from a live document, and refuses an archived or unknown one', async () => {
      const { id } = (await create('member').expect(201)).body;
      const note = (title: string, documentId: string) =>
        post('/api/v1/notes', 'member', {
          title,
          content: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Revisar cláusulas' }] },
            ],
          },
          links: [{ entityType: 'DOCUMENT', entityId: documentId }],
        });
      const made = await note('Sobre el NDA', id).expect(201);
      expect(made.body.links).toEqual([
        { type: 'DOCUMENT', id, code: 'DOC-0001', label: 'NDA con Kairos' },
      ]);

      const feed = await get(`/api/v1/notes?entityType=DOCUMENT&entityId=${id}`, 'viewer').expect(
        200,
      );
      expect(feed.body.items.map((n: { id: string }) => n.id)).toEqual([made.body.id]);

      await note('x', 'doc_missing').expect(404);
      await post(`${BASE}/${id}/archive`, 'admin').expect(200);
      await note('y', id).expect(404);
    });
  });

  it('documents every route in the OpenAPI document', () => {
    const doc = buildOpenApiDocument(app);
    const operations = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
      path.startsWith('/api/v1/documents')
        ? Object.keys(item ?? {}).map((method) => `${method.toUpperCase()} ${path}`)
        : [],
    );
    expect(operations.sort()).toEqual(
      [
        'GET /api/v1/documents',
        'POST /api/v1/documents',
        'GET /api/v1/documents/category-counts',
        'POST /api/v1/documents/archive',
        'GET /api/v1/documents/{id}',
        'PATCH /api/v1/documents/{id}',
        'POST /api/v1/documents/{id}/status',
        'POST /api/v1/documents/{id}/archive',
        'POST /api/v1/documents/{id}/restore',
        'POST /api/v1/documents/{id}/links',
        'DELETE /api/v1/documents/{id}/links/{entityType}/{entityId}',
      ].sort(),
    );
  });
});
