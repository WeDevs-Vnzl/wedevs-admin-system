import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOpenApiDocument } from '../../../src/app.setup';
import { DocumentVersionsModule } from '../../../src/modules/documents/document-versions.module';
import { MatrixAuthorization } from '../../../src/modules/identity/infrastructure/matrix-authorization';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1/documents';
const NDA = 'dtyp_nda';
const PRD = 'dtyp_prd';
const LINKS = 'dtyp_credenciales';

interface VersionRow {
  id: string;
  versionNumber: number;
  format: string;
  isCurrent: boolean;
  content?: string | null;
  changelog: string | null;
  url: string | null;
  file: { id: string } | null;
}

describe('document versions (e2e): HU-18 CA1-CA3, HU-19 CA4, DT-136, DT-138, A3', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  const authenticator = new FakeAuthenticator();
  const storage = new InMemoryFileStorage();
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

  async function file(id: string, key: string, status: 'READY' | 'PENDING' = 'READY') {
    await prisma.file.create({
      data: {
        id,
        storageKey: `general/2026/10/${id}`,
        bucket: 'memory',
        originalName: `${id}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 100,
        status,
        uploadedById: users[key]?.userId ?? '',
      },
    });
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp({
      modules: [DocumentVersionsModule],
      authenticator,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FILE_STORAGE, useValue: storage },
      ],
    });
  });
  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    await user('OWNER', 'owner');
    await user('ADMIN', 'admin');
    await user('MEMBER', 'member');
    await user('VIEWER', 'viewer');
    await prisma.client.create({
      data: {
        id: 'cli_k',
        code: 'CLI-0001',
        kind: 'EMPRESA',
        tradeName: 'Kairos',
        legalName: 'Kairos SA',
        taxId: 'J-1',
        country: 'VE',
        address: 'x',
        phone: '1',
      },
    });
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
  const put = (path: string, key: string, body: unknown) =>
    http()
      .put(path)
      .set('Authorization', as(key))
      .send(body as object);

  const create = (key: string, over: Record<string, unknown> = {}) =>
    post(BASE, key, {
      title: 'Documento',
      typeId: PRD,
      links: [{ entityType: 'CLIENT', entityId: 'cli_k' }],
      ...over,
    });
  const newDoc = async (key = 'owner', over: Record<string, unknown> = {}) =>
    (await create(key, over).expect(201)).body as { id: string };
  const publish = (id: string, key: string, content: string, changelog?: string) =>
    post(`${BASE}/${id}/versions/publish`, key, { content, changelog });
  const history = async (id: string, key = 'viewer') =>
    (await get(`${BASE}/${id}/versions`, key).expect(200)).body as VersionRow[];

  it('requires authentication on every route', async () => {
    await http().get(`${BASE}/x/versions`).expect(401);
    await http().get(`${BASE}/x/versions/y`).expect(401);
    await http().put(`${BASE}/x/draft`).send({ content: 'x' }).expect(401);
    await http().post(`${BASE}/x/versions/publish`).send({}).expect(401);
    await http().post(`${BASE}/x/versions`).send({}).expect(401);
    await http().post(`${BASE}/x/versions/y/restore`).send({}).expect(401);
  });

  describe('HU-18 CA1-CA3: markdown draft, publish, history and restore', () => {
    it('saves the draft explicitly without creating a version, then publishes it as version 1', async () => {
      const doc = await newDoc('member');

      const saved = await put(`${BASE}/${doc.id}/draft`, 'member', {
        content: '# PRD\n\nBorrador',
      }).expect(200);
      expect(saved.body).toEqual({ documentId: doc.id, draftUpdatedAt: expect.any(String) });
      expect(await history(doc.id)).toEqual([]);
      const detail = (await get(`${BASE}/${doc.id}`, 'viewer').expect(200)).body;
      expect(detail).toMatchObject({ draftContent: '# PRD\n\nBorrador', versionCount: 0 });
      expect(detail.draftUpdatedAt).toBe(saved.body.draftUpdatedAt);
      expect(
        await prisma.activityLog.findMany({
          where: { entityId: doc.id, action: 'UPDATE' },
        }),
      ).toEqual([expect.objectContaining({ metadata: { draft: true }, changes: null })]);

      const published = await post(`${BASE}/${doc.id}/versions/publish`, 'member', {
        changelog: 'Primera versión',
      }).expect(201);
      expect(published.body).toMatchObject({
        draftContent: null,
        draftUpdatedAt: null,
        versionCount: 1,
        currentVersion: {
          versionNumber: 1,
          format: 'MARKDOWN',
          content: '# PRD\n\nBorrador',
          changelog: 'Primera versión',
          isCurrent: true,
          createdBy: { id: users.member?.userId, name: 'member' },
        },
      });
    });

    it('publishes the text the editor sends and refuses an empty publish (VALIDATION on content)', async () => {
      const doc = await newDoc();
      const empty = await post(`${BASE}/${doc.id}/versions/publish`, 'owner', {}).expect(422);
      expect(empty.body.error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { content: ['validation.required'] },
      });
      await post(`${BASE}/${doc.id}/versions/publish`, 'owner', { content: '' }).expect(422);
      await publish(doc.id, 'owner', '# v1').expect(201);
      expect(await history(doc.id)).toHaveLength(1);
    });

    it('lists the history newest first without content, and GET both versions supplies the FE diff', async () => {
      const doc = await newDoc();
      await publish(doc.id, 'owner', '# Título\n\nUno', 'v1').expect(201);
      await publish(doc.id, 'owner', '# Título\n\nDos', 'v2').expect(201);

      const rows = await history(doc.id);
      expect(rows.map((row) => [row.versionNumber, row.isCurrent, row.changelog])).toEqual([
        [2, true, 'v2'],
        [1, false, 'v1'],
      ]);
      expect(rows[0]).not.toHaveProperty('content');
      const [older, newer] = await Promise.all(
        [rows[1], rows[0]].map(async (row) => {
          const res = await get(`${BASE}/${doc.id}/versions/${row?.id}`, 'viewer').expect(200);
          return res.body as VersionRow;
        }),
      );
      expect(older).toMatchObject({
        versionNumber: 1,
        content: '# Título\n\nUno',
        isCurrent: false,
      });
      expect(newer).toMatchObject({
        versionNumber: 2,
        content: '# Título\n\nDos',
        isCurrent: true,
      });
    });

    it('restores an old version as a new current one and keeps the history', async () => {
      const doc = await newDoc();
      await publish(doc.id, 'owner', '# uno').expect(201);
      await publish(doc.id, 'owner', '# dos').expect(201);
      const first = (await history(doc.id)).find((row) => row.versionNumber === 1);

      const restored = await post(`${BASE}/${doc.id}/versions/${first?.id}/restore`, 'member', {
        changelog: 'Volvemos',
      }).expect(201);

      expect(restored.body.currentVersion).toMatchObject({
        versionNumber: 3,
        content: '# uno',
        changelog: 'Volvemos',
        isCurrent: true,
      });
      expect((await history(doc.id)).map((row) => row.versionNumber)).toEqual([3, 2, 1]);
      const entry = await prisma.activityLog.findFirst({
        where: { entityId: doc.id, action: 'VERSION_PUBLISH' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry?.metadata).toMatchObject({ versionNumber: 3, restoredFrom: 1 });
    });

    it('answers NOT_FOUND for a version of another document and CONFLICT for a file document', async () => {
      const doc = await newDoc();
      const other = await newDoc('owner', { title: 'Otro' });
      await publish(other.id, 'owner', '# otro').expect(201);
      const foreign = (await history(other.id))[0];
      await get(`${BASE}/${doc.id}/versions/${foreign?.id}`, 'owner').expect(404);
      await post(`${BASE}/${doc.id}/versions/${foreign?.id}/restore`, 'owner').expect(404);

      const nda = await newDoc('owner', { typeId: NDA });
      const conflict = await put(`${BASE}/${nda.id}/draft`, 'owner', { content: '# x' }).expect(
        409,
      );
      expect(conflict.body.error.code).toBe('CONFLICT');
      await publish(nda.id, 'owner', '# x').expect(409);
    });
  });

  describe('HU-19 CA4 and DT-138: the version lock', () => {
    async function lockedPrd(status: 'FIRMADO' | 'VENCIDO', signedAt: string | null) {
      const doc = await newDoc();
      await publish(doc.id, 'owner', '# v1').expect(201);
      await prisma.document.update({
        where: { id: doc.id },
        data: { status, signedAt: signedAt ? new Date(signedAt) : null },
      });
      return doc;
    }

    it.each([
      ['FIRMADO', '2026-10-08'],
      ['VENCIDO', '2026-10-08'],
    ] as const)(
      'a %s document with a signature date refuses draft, publish, upload and restore',
      async (status, signedAt) => {
        const doc = await lockedPrd(status, signedAt);
        const v1 = (await history(doc.id))[0];
        const locked = [
          await put(`${BASE}/${doc.id}/draft`, 'owner', { content: 'x' }),
          await publish(doc.id, 'owner', '# v2'),
          await post(`${BASE}/${doc.id}/versions`, 'owner', {
            format: 'ENLACE',
            url: 'https://x.test/a',
          }),
          await post(`${BASE}/${doc.id}/versions/${v1?.id}/restore`, 'owner'),
        ];
        for (const res of locked) {
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('INTEGRITY_LOCK');
        }
        expect(await history(doc.id)).toHaveLength(1);
      },
    );

    it('a VENCIDO document without a signature date is not locked', async () => {
      const doc = await lockedPrd('VENCIDO', null);
      await publish(doc.id, 'owner', '# v2').expect(201);
    });

    it('a signed NDA (set through the status route) refuses a new file version', async () => {
      await file('fil_1', 'owner');
      await file('fil_2', 'owner');
      const nda = await newDoc('owner', {
        typeId: NDA,
        initialVersion: { format: 'ARCHIVO', fileId: 'fil_1' },
      });
      for (const status of ['EN_REVISION', 'APROBADO', 'ENVIADO']) {
        await post(`${BASE}/${nda.id}/status`, 'owner', { status }).expect(200);
      }
      await post(`${BASE}/${nda.id}/status`, 'owner', {
        status: 'FIRMADO',
        signedAt: '2026-10-08',
      }).expect(200);

      const res = await post(`${BASE}/${nda.id}/versions`, 'owner', {
        format: 'ARCHIVO',
        fileId: 'fil_2',
      }).expect(409);
      expect(res.body.error.code).toBe('INTEGRITY_LOCK');
      expect(await history(nda.id)).toHaveLength(1);
    });
  });

  describe('uploadVersion and restore of a file version (DT-136)', () => {
    it('attaches files and links, restores an ARCHIVO version reusing its file, and refuses a held file', async () => {
      await file('fil_1', 'member');
      await file('fil_2', 'member');
      const nda = await newDoc('member', {
        typeId: NDA,
        initialVersion: { format: 'ARCHIVO', fileId: 'fil_1' },
      });

      const second = await post(`${BASE}/${nda.id}/versions`, 'member', {
        format: 'ARCHIVO',
        fileId: 'fil_2',
        changelog: 'Firmada',
      }).expect(201);
      expect(second.body.currentVersion).toMatchObject({
        versionNumber: 2,
        file: { id: 'fil_2', originalName: 'fil_2.pdf' },
      });
      expect(JSON.stringify(second.body)).not.toContain('storageKey');

      const link = await post(`${BASE}/${nda.id}/versions`, 'member', {
        format: 'ENLACE',
        url: 'https://vault.example.com/a',
      }).expect(201);
      expect(link.body.currentVersion).toMatchObject({ versionNumber: 3, format: 'ENLACE' });

      await post(`${BASE}/${nda.id}/versions`, 'member', {
        format: 'ARCHIVO',
        fileId: 'fil_1',
      }).expect(409);

      const first = (await history(nda.id)).find((row) => row.versionNumber === 1);
      const restored = await post(
        `${BASE}/${nda.id}/versions/${first?.id}/restore`,
        'viewer',
      ).expect(403);
      expect(restored.body.error.code).toBe('FORBIDDEN');
      const ok = await post(`${BASE}/${nda.id}/versions/${first?.id}/restore`, 'member').expect(
        201,
      );
      expect(ok.body.currentVersion).toMatchObject({ versionNumber: 4, file: { id: 'fil_1' } });
      expect(await prisma.documentVersion.count({ where: { fileId: 'fil_1' } })).toBe(2);
    });

    it('answers NOT_FOUND for an unknown, a PENDING or an unattached foreign file', async () => {
      await file('fil_pending', 'owner', 'PENDING');
      await file('fil_foreign', 'owner');
      const nda = await newDoc('member', { typeId: NDA });
      for (const fileId of ['fil_missing', 'fil_pending', 'fil_foreign']) {
        await post(`${BASE}/${nda.id}/versions`, 'member', { format: 'ARCHIVO', fileId }).expect(
          404,
        );
      }
      expect(await history(nda.id)).toEqual([]);
    });

    it('answers VALIDATION for a link that is not http(s) and for a body missing its field', async () => {
      const nda = await newDoc('member', { typeId: LINKS });
      const bad = await post(`${BASE}/${nda.id}/versions`, 'member', {
        format: 'ENLACE',
        url: 'javascript:alert(1)',
      }).expect(422);
      expect(bad.body.error.fieldErrors).toHaveProperty('url');
      await post(`${BASE}/${nda.id}/versions`, 'member', { format: 'ENLACE' }).expect(422);
      await post(`${BASE}/${nda.id}/versions`, 'member', { format: 'ARCHIVO' }).expect(422);
      expect(await history(nda.id)).toEqual([]);
    });
  });

  describe('roles', () => {
    it('lets a Viewer read versions but refuses every write (403), a Member write', async () => {
      const doc = await newDoc('member');
      await publish(doc.id, 'member', '# v1').expect(201);
      const [row] = await history(doc.id, 'viewer');
      await get(`${BASE}/${doc.id}/versions/${row?.id}`, 'viewer').expect(200);

      await put(`${BASE}/${doc.id}/draft`, 'viewer', { content: 'x' }).expect(403);
      await publish(doc.id, 'viewer', '# x').expect(403);
      await post(`${BASE}/${doc.id}/versions`, 'viewer', {
        format: 'ENLACE',
        url: 'https://x.test/a',
      }).expect(403);
      await post(`${BASE}/${doc.id}/versions/${row?.id}/restore`, 'viewer').expect(403);
      expect(await history(doc.id)).toHaveLength(1);
    });

    it('hides the versions of an archived document from Member and Viewer, not from the trash roles', async () => {
      const doc = await newDoc();
      await publish(doc.id, 'owner', '# v1').expect(201);
      const [row] = await history(doc.id);
      await post(`${BASE}/${doc.id}/archive`, 'owner').expect(200);

      for (const key of ['member', 'viewer']) {
        await get(`${BASE}/${doc.id}/versions`, key).expect(404);
        await get(`${BASE}/${doc.id}/versions/${row?.id}`, key).expect(404);
      }
      await get(`${BASE}/${doc.id}/versions`, 'admin').expect(200);
      await put(`${BASE}/${doc.id}/draft`, 'owner', { content: 'x' }).expect(404);
    });
  });

  describe('file download by role (C23, A3)', () => {
    it('lets a Viewer download a file of a live document version, not an unattached one', async () => {
      await file('fil_doc', 'member');
      await file('fil_loose', 'member');
      await newDoc('member', {
        typeId: NDA,
        initialVersion: { format: 'ARCHIVO', fileId: 'fil_doc' },
      });

      const ok = await get('/api/v1/files/fil_doc/download', 'viewer').expect(302);
      expect(ok.headers.location).toBeTruthy();
      await get('/api/v1/files/fil_loose/download', 'viewer').expect(404);
      await get('/api/v1/files/fil_loose/download', 'member').expect(302);
    });

    it('fails closed once the document is archived and opens again on restore', async () => {
      await file('fil_doc', 'member');
      const doc = await newDoc('member', {
        typeId: NDA,
        initialVersion: { format: 'ARCHIVO', fileId: 'fil_doc' },
      });
      await get('/api/v1/files/fil_doc/download', 'viewer').expect(302);

      await post(`${BASE}/${doc.id}/archive`, 'owner').expect(200);
      await get('/api/v1/files/fil_doc/download', 'viewer').expect(404);

      await post(`${BASE}/${doc.id}/restore`, 'owner').expect(200);
      await get('/api/v1/files/fil_doc/download', 'viewer').expect(302);
    });
  });

  it('describes the version routes in the OpenAPI document', () => {
    const paths = buildOpenApiDocument(app).paths;
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/documents/{id}/versions',
        '/api/v1/documents/{id}/versions/{versionId}',
        '/api/v1/documents/{id}/versions/publish',
        '/api/v1/documents/{id}/versions/{versionId}/restore',
        '/api/v1/documents/{id}/draft',
      ]),
    );
  });
});
