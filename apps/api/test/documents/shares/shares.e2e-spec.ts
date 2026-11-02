import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentRecordsModule } from '../../../src/modules/documents/document-records.module';
import { MarkExpiredShareLinks } from '../../../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { ShareLinksModule } from '../../../src/modules/documents/share-links.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION, CLOCK } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp, TEST_APP_URL } from '../../support/test-app';
import { must } from './must';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1/share-links';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('share links (e2e): HU-22 CA1, CA6, DT-45, DT-137', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
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
      modules: [DocumentRecordsModule, ShareLinksModule],
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
      data: [
        { id: 'cli_k', code: 'CLI-0001', tradeName: 'Kairos' },
        { id: 'cli_s', code: 'CLI-0002', tradeName: 'Solaris' },
      ].map((client) => ({
        ...client,
        kind: 'EMPRESA' as const,
        legalName: `${client.tradeName} SA`,
        taxId: client.id,
        country: 'VE',
        address: 'x',
        phone: '1',
      })),
    });
    const creator = users['owner'] as CurrentUser;
    for (const [id, versions] of [
      ['doc_a', 2],
      ['doc_b', 1],
      ['doc_draft', 0],
    ] as const) {
      await prisma.document.create({
        data: {
          id,
          code: `DOC-${id}`,
          title: `Documento ${id}`,
          typeId: 'dtyp_nda',
          status: 'APROBADO',
          createdById: creator.userId,
        },
      });
      for (let n = 1; n <= versions; n += 1) {
        await prisma.documentVersion.create({
          data: {
            id: `${id}_v${n}`,
            documentId: id,
            versionNumber: n,
            format: 'MARKDOWN',
            content: `# ${id} v${n}`,
            createdById: creator.userId,
          },
        });
        await prisma.document.update({ where: { id }, data: { currentVersionId: `${id}_v${n}` } });
      }
    }
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

  const form = (over: Record<string, unknown> = {}) => ({
    title: 'Propuesta Kairos',
    documents: [{ documentId: 'doc_a', requiresAccessKey: false }],
    ...over,
  });
  const create = (key: string, over: Record<string, unknown> = {}) => post(BASE, key, form(over));
  const created = async (over: Record<string, unknown> = {}) =>
    (await create('owner', over).expect(201)).body as Body;
  /** The edit form of an existing link, as the FE resubmits it. */
  const editOf = (share: Body, over: Record<string, unknown> = {}) => ({
    title: share.title,
    message: share.message,
    clientId: share.client?.id ?? null,
    locale: share.locale,
    allowDownload: share.allowDownload,
    expiresAt: share.expiresAt,
    documents: (share.documents as Body[]).map((doc) => ({
      documentId: doc.document.id,
      versionId: doc.versionId,
      requiresAccessKey: doc.requiresAccessKey,
    })),
    ...over,
  });
  const activity = (shareLinkId: string) =>
    prisma.activityLog.findMany({
      where: { entityType: 'SHARE_LINK', entityId: shareLinkId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  it('requires authentication on every route', async () => {
    await http().get(BASE).expect(401);
    await http().post(BASE).send({}).expect(401);
    await http().get(`${BASE}/x`).expect(401);
    await http().patch(`${BASE}/x`).send({}).expect(401);
    await http().post(`${BASE}/x/revoke`).send({}).expect(401);
    await http().post(`${BASE}/x/documents/y/access-key`).send({}).expect(401);
    await http().get(`${BASE}/x/access-log`).expect(401);
  });

  describe('Member and Viewer are refused on every route (PRD §4.3: Owner and Admin only)', () => {
    it.each(['member', 'viewer'])('answers 403 FORBIDDEN to %s and writes nothing', async (key) => {
      const share = await created();
      const calls = [
        () => get(BASE, key),
        () => post(BASE, key, form()),
        () => get(`${BASE}/${share.id}`, key),
        () => patch(`${BASE}/${share.id}`, key, form()),
        () => post(`${BASE}/${share.id}/revoke`, key),
        () => post(`${BASE}/${share.id}/documents/doc_a/access-key`, key, { action: 'generate' }),
        () => get(`${BASE}/${share.id}/access-log`, key),
      ];
      for (const call of calls) {
        const res = await call().expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(await prisma.shareLink.count()).toBe(1);
      expect(await activity(share.id)).toHaveLength(1);
    });

    it('lets an admin manage links', async () => {
      const res = await create('admin').expect(201);
      expect(res.body.share.status).toBe('ACTIVE');
      await get(BASE, 'admin').expect(200);
    });
  });

  describe('HU-22 CA1: a link with a 43-character token', () => {
    it('creates it with the URL, the client, the documents and a key shown once', async () => {
      const res = await create('owner', {
        message: 'Para revisión',
        clientId: 'cli_k',
        locale: 'en',
        allowDownload: false,
        expiresAt: '2026-12-31',
        documents: [
          { documentId: 'doc_a', versionId: null, requiresAccessKey: true },
          { documentId: 'doc_b', versionId: 'doc_b_v1' },
        ],
      }).expect(201);

      const { share, generatedKeys } = res.body as { share: Body; generatedKeys: Body[] };
      expect(share.token).toMatch(TOKEN_PATTERN);
      expect(share.url).toBe(`${TEST_APP_URL}/s/${share.token}`);
      expect(share).toMatchObject({
        title: 'Propuesta Kairos',
        message: 'Para revisión',
        client: { type: 'CLIENT', id: 'cli_k', code: 'CLI-0001', label: 'Kairos' },
        locale: 'en',
        allowDownload: false,
        expiresAt: '2026-12-31',
        revokedAt: null,
        status: 'ACTIVE',
        lastAccessedAt: null,
        counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
        createdBy: { id: users['owner']?.userId, name: 'owner' },
      });
      expect(share.documents).toHaveLength(2);
      expect(share.documents[0]).toMatchObject({
        document: { type: 'DOCUMENT', id: 'doc_a', code: 'DOC-doc_a', label: 'Documento doc_a' },
        documentStatus: 'APROBADO',
        versionId: null,
        isLatest: true,
        versionNumber: 2,
        format: 'MARKDOWN',
        order: 0,
        requiresAccessKey: true,
      });
      expect(share.documents[0].accessKeyUpdatedAt).toEqual(expect.any(String));
      expect(share.documents[1]).toMatchObject({
        order: 1,
        requiresAccessKey: false,
        accessKeyUpdatedAt: null,
      });

      expect(generatedKeys).toHaveLength(1);
      expect(generatedKeys[0]).toMatchObject({ documentId: 'doc_a' });
      expect(generatedKeys[0]?.accessKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    });

    it('stores only the scrypt hash and never shows a key, a hash or the token anywhere else', async () => {
      const res = await create('owner', {
        documents: [{ documentId: 'doc_a', requiresAccessKey: true }],
      }).expect(201);
      const share = res.body.share as Body;
      const clear = must(res.body.generatedKeys[0]).accessKey as string;

      const row = await prisma.shareLinkDocument.findFirstOrThrow({
        where: { shareLinkId: share.id },
      });
      const hash = must(row.accessKeyHash);
      expect(hash.startsWith('scrypt$')).toBe(true);
      expect(hash).not.toContain(clear);

      // Every read DTO of the module.
      const reads = [
        await get(`${BASE}/${share.id}`, 'owner').expect(200),
        await get(BASE, 'owner').expect(200),
        await get(`${BASE}/${share.id}/access-log`, 'owner').expect(200),
      ];
      for (const read of reads) {
        const text = JSON.stringify(read.body);
        expect(text).not.toContain(clear);
        expect(text).not.toContain(hash);
        expect(text).not.toMatch(/scrypt|accessKeyHash|"accessKey"|generatedKeys/);
      }
      // The activity rows: no key, no hash, no token.
      await post(`${BASE}/${share.id}/documents/doc_a/access-key`, 'owner', {
        action: 'regenerate',
      }).expect(200);
      const log = JSON.stringify(await activity(share.id));
      expect(log).not.toContain(clear);
      expect(log).not.toContain(hash);
      expect(log).not.toContain(share.token);
      expect(log).not.toContain('scrypt');
    });

    it('records SHARE_CREATE with the counts', async () => {
      const share = await created({
        documents: [
          { documentId: 'doc_a', requiresAccessKey: true },
          { documentId: 'doc_b', requiresAccessKey: false },
        ],
      });
      const [entry] = await activity(share.share.id);
      expect(entry).toMatchObject({
        action: 'SHARE_CREATE',
        entityLabel: 'Propuesta Kairos',
        actorType: 'USER',
        actorId: users['owner']?.userId,
        metadata: { documentCount: 2, protectedDocumentCount: 1 },
      });
    });
  });

  describe('validation lives in the use case', () => {
    const rejected = async (over: Record<string, unknown>, field: string) => {
      const res = await create('owner', over).expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.fieldErrors).toHaveProperty([field]);
      expect(await prisma.shareLink.count()).toBe(0);
    };

    it('rejects a version of another document, an unknown document and one without a version', async () => {
      await rejected(
        { documents: [{ documentId: 'doc_b', versionId: 'doc_a_v1' }] },
        'documents.0.versionId',
      );
      await rejected({ documents: [{ documentId: 'doc_missing' }] }, 'documents.0.documentId');
      await rejected({ documents: [{ documentId: 'doc_draft' }] }, 'documents.0.documentId');
    });

    it('rejects an archived document, a past expiry and an unknown client', async () => {
      await prisma.document.update({ where: { id: 'doc_b' }, data: { deletedAt: new Date() } });
      await rejected({ documents: [{ documentId: 'doc_b' }] }, 'documents.0.documentId');
      await rejected({ expiresAt: '2026-10-29' }, 'expiresAt');
      await rejected({ clientId: 'cli_missing' }, 'clientId');
    });

    it('rejects an empty or repeated document list, a blank title and a bad locale in the DTO', async () => {
      await rejected({ documents: [] }, 'documents');
      await rejected({ title: '   ' }, 'title');
      await rejected({ locale: 'fr' }, 'locale');
      expect((await create('owner', { expiresAt: 'soon' }).expect(422)).body.error.code).toBe(
        'VALIDATION',
      );
    });

    it('accepts today as the last valid day', async () => {
      const share = await created({ expiresAt: '2026-10-30' });
      expect(share.share.status).toBe('ACTIVE');
    });
  });

  describe('HU-22 CA6: pinned vs latest at the management level', () => {
    it('shows the pinned version and follows the latest one after a new version', async () => {
      const { share } = await created({
        documents: [
          { documentId: 'doc_a', versionId: 'doc_a_v1' },
          { documentId: 'doc_b', versionId: null },
        ],
      });
      expect(
        share.documents.map((doc: Body) => [doc.versionId, doc.versionNumber, doc.isLatest]),
      ).toEqual([
        ['doc_a_v1', 1, false],
        [null, 1, true],
      ]);

      // A new version of each document is published.
      for (const id of ['doc_a', 'doc_b']) {
        const next = await prisma.documentVersion.count({ where: { documentId: id } });
        await prisma.documentVersion.create({
          data: {
            id: `${id}_v${next + 1}`,
            documentId: id,
            versionNumber: next + 1,
            format: 'MARKDOWN',
            content: '# nuevo',
            createdById: users['owner']?.userId ?? '',
          },
        });
        await prisma.document.update({
          where: { id },
          data: { currentVersionId: `${id}_v${next + 1}` },
        });
      }

      const detail = (await get(`${BASE}/${share.id}`, 'owner').expect(200)).body as Body;
      expect(
        detail.documents.map((doc: Body) => [doc.versionId, doc.versionNumber, doc.isLatest]),
      ).toEqual([
        ['doc_a_v1', 1, false],
        [null, 2, true],
      ]);
    });
  });

  describe('access keys (DT-45)', () => {
    const keyUrl = (shareId: string, documentId: string) =>
      `${BASE}/${shareId}/documents/${documentId}/access-key`;

    it('generates, regenerates and removes a key, answering CONFLICT to a stale combination', async () => {
      const { share } = await created({
        documents: [{ documentId: 'doc_a' }, { documentId: 'doc_b', requiresAccessKey: true }],
      });
      const url = keyUrl(share.id, 'doc_a');

      const generated = await post(url, 'owner', { action: 'generate' }).expect(200);
      expect(generated.body).toMatchObject({
        shareLinkId: share.id,
        documentId: 'doc_a',
        action: 'generate',
        requiresAccessKey: true,
      });
      expect(generated.body.accessKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
      expect(generated.body.accessKeyUpdatedAt).toEqual(expect.any(String));
      const firstHash = must(
        (await prisma.shareLinkDocument.findFirstOrThrow({ where: { documentId: 'doc_a' } }))
          .accessKeyHash,
      );

      const again = await post(url, 'owner', { action: 'generate' }).expect(409);
      expect(again.body.error.code).toBe('CONFLICT');

      const regenerated = await post(url, 'owner', { action: 'regenerate' }).expect(200);
      expect(regenerated.body.accessKey).not.toBe(generated.body.accessKey);
      const secondHash = must(
        (await prisma.shareLinkDocument.findFirstOrThrow({ where: { documentId: 'doc_a' } }))
          .accessKeyHash,
      );
      expect(secondHash).not.toBe(firstHash);

      const removed = await post(url, 'owner', { action: 'remove' }).expect(200);
      expect(removed.body).toMatchObject({
        action: 'remove',
        requiresAccessKey: false,
        accessKeyUpdatedAt: null,
        accessKey: null,
      });
      expect((await post(url, 'owner', { action: 'remove' }).expect(409)).body.error.code).toBe(
        'CONFLICT',
      );
      expect((await post(url, 'owner', { action: 'regenerate' }).expect(409)).body.error.code).toBe(
        'CONFLICT',
      );

      const log = await activity(share.id);
      const keyEntries = log.filter((entry) => entry.action === 'UPDATE');
      expect(keyEntries).toHaveLength(3);
      expect(keyEntries.map((entry) => entry.changes)).toEqual([
        { accessKey: 'changed' },
        { accessKey: 'changed' },
        { accessKey: 'changed' },
      ]);
      expect(keyEntries.map((entry) => (entry.metadata as Body).accessKeyAction)).toEqual([
        'generate',
        'regenerate',
        'remove',
      ]);
    });

    it('answers 404 for a document outside the link, an unknown link and 422 for an unknown action', async () => {
      const { share } = await created();
      expect(
        (await post(keyUrl(share.id, 'doc_b'), 'owner', { action: 'generate' }).expect(404)).body
          .error.code,
      ).toBe('NOT_FOUND');
      await post(keyUrl('missing', 'doc_a'), 'owner', { action: 'generate' }).expect(404);
      const bad = await post(keyUrl(share.id, 'doc_a'), 'owner', { action: 'rotate' }).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION');
    });
  });

  describe('edit and revoke', () => {
    it('edits the whole form, keeps the token and the existing key, and shows a new key once', async () => {
      const { share, generatedKeys } = (
        await create('owner', {
          documents: [{ documentId: 'doc_a', requiresAccessKey: true }, { documentId: 'doc_b' }],
        }).expect(201)
      ).body as { share: Body; generatedKeys: Body[] };
      expect(generatedKeys).toHaveLength(1);
      const keptHash = must(
        (await prisma.shareLinkDocument.findFirstOrThrow({ where: { documentId: 'doc_a' } }))
          .accessKeyHash,
      );

      const res = await patch(
        `${BASE}/${share.id}`,
        'admin',
        editOf(share, {
          title: 'Entrega final',
          clientId: 'cli_s',
          locale: 'en',
          expiresAt: '2026-12-31',
          documents: [
            { documentId: 'doc_b', versionId: null, requiresAccessKey: true },
            { documentId: 'doc_a', versionId: 'doc_a_v1', requiresAccessKey: true },
          ],
        }),
      ).expect(200);

      expect(res.body.share).toMatchObject({
        id: share.id,
        token: share.token,
        title: 'Entrega final',
        client: { id: 'cli_s' },
        locale: 'en',
        expiresAt: '2026-12-31',
      });
      expect(res.body.share.documents.map((doc: Body) => doc.document.id)).toEqual([
        'doc_b',
        'doc_a',
      ]);
      expect(res.body.generatedKeys.map((key: Body) => key.documentId)).toEqual(['doc_b']);
      expect(
        (await prisma.shareLinkDocument.findFirstOrThrow({ where: { documentId: 'doc_a' } }))
          .accessKeyHash,
      ).toBe(keptHash);

      const [, update] = await activity(share.id);
      expect(update).toMatchObject({
        action: 'UPDATE',
        actorId: users['admin']?.userId,
        changes: expect.objectContaining({
          title: ['Propuesta Kairos', 'Entrega final'],
          locale: ['es', 'en'],
          documents: 'changed',
          accessKey: 'changed',
        }),
      });
    });

    it('pins the current version when versionId is omitted, follows the latest on null, and a new version moves only the latter (DT-150)', async () => {
      const { share } = await created({
        documents: [{ documentId: 'doc_a' }, { documentId: 'doc_b', versionId: null }],
      });
      const explicit = await created({
        documents: [{ documentId: 'doc_a', versionId: 'doc_a_v1' }],
      });
      const stored = async (id: string) =>
        (
          await prisma.shareLinkDocument.findMany({
            where: { shareLinkId: id },
            orderBy: { order: 'asc' },
          })
        ).map((row) => [row.documentId, row.versionId]);

      expect(share.documents.map((doc: Body) => [doc.versionId, doc.versionNumber])).toEqual([
        ['doc_a_v2', 2],
        [null, 1],
      ]);
      expect(await stored(share.id)).toEqual([
        ['doc_a', 'doc_a_v2'],
        ['doc_b', null],
      ]);
      expect(await stored(explicit.share.id)).toEqual([['doc_a', 'doc_a_v1']]);

      // doc_a gets a v3: the omitted-then-pinned link keeps serving v2.
      await prisma.documentVersion.create({
        data: {
          id: 'doc_a_v3',
          documentId: 'doc_a',
          versionNumber: 3,
          format: 'MARKDOWN',
          content: '# v3',
          createdById: (users['owner'] as CurrentUser).userId,
        },
      });
      await prisma.document.update({
        where: { id: 'doc_a' },
        data: { currentVersionId: 'doc_a_v3' },
      });
      const detail = (await get(`${BASE}/${share.id}`, 'owner').expect(200)).body as Body;
      expect(detail.documents[0]).toMatchObject({
        versionId: 'doc_a_v2',
        versionNumber: 2,
        isLatest: false,
      });
      expect(await stored(share.id)).toEqual([
        ['doc_a', 'doc_a_v2'],
        ['doc_b', null],
      ]);
    });

    it('revokes a link as a final state: edits, keys and a second revoke are INTEGRITY_LOCK', async () => {
      const { share } = await created({
        documents: [{ documentId: 'doc_a', requiresAccessKey: true }],
      });
      const revoked = await post(`${BASE}/${share.id}/revoke`, 'owner').expect(200);
      expect(revoked.body).toMatchObject({ id: share.id, status: 'REVOKED' });
      expect(revoked.body.revokedAt).toEqual(expect.any(String));

      for (const call of [
        () => patch(`${BASE}/${share.id}`, 'owner', editOf(share, { title: 'Otro' })),
        () => post(`${BASE}/${share.id}/revoke`, 'owner'),
        () =>
          post(`${BASE}/${share.id}/documents/doc_a/access-key`, 'owner', { action: 'regenerate' }),
      ]) {
        const res = await call().expect(409);
        expect(res.body.error.code).toBe('INTEGRITY_LOCK');
      }
      expect((await get(`${BASE}/${share.id}`, 'owner').expect(200)).body.title).toBe(
        'Propuesta Kairos',
      );
      expect((await activity(share.id)).map((entry) => entry.action)).toEqual([
        'SHARE_CREATE',
        'SHARE_REVOKE',
      ]);
    });

    it.each([
      ['requiresAccessKey', 'documents.0.requiresAccessKey'],
      ['expiresAt', 'expiresAt'],
      ['allowDownload', 'allowDownload'],
      ['versionId', 'documents.0.versionId'],
      ['locale', 'locale'],
      ['message', 'message'],
      ['clientId', 'clientId'],
    ] as const)(
      'refuses a PATCH that omits %s with 422 and changes nothing (no fail-open on keys, expiry, pin, locale, message, client)',
      async (_name, path) => {
        const { share } = (
          await create('owner', {
            expiresAt: '2026-12-31',
            allowDownload: false,
            documents: [{ documentId: 'doc_a', requiresAccessKey: true }],
          }).expect(201)
        ).body as { share: Body };
        const before = await prisma.shareLink.findUniqueOrThrow({
          where: { id: share.id },
          include: { documents: true },
        });
        const logged = (await activity(share.id)).length;

        const full = editOf(share, { title: 'Cambiado' });
        const omit = (record: Body, key: string): Body => {
          const { [key]: _omitted, ...rest } = record;
          return rest;
        };
        const body = path.startsWith('documents.')
          ? {
              ...full,
              documents: (full.documents as Body[]).map((doc, index) =>
                index === 0 ? omit(doc, path.split('.')[2] ?? '') : doc,
              ),
            }
          : omit(full, path);
        const res = await patch(`${BASE}/${share.id}`, 'owner', body).expect(422);

        expect(res.body.error.code).toBe('VALIDATION');
        expect(Object.keys(res.body.error.fieldErrors)).toContain(path);
        const after = await prisma.shareLink.findUniqueOrThrow({
          where: { id: share.id },
          include: { documents: true },
        });
        expect(after).toEqual(before);
        expect(after.title).toBe('Propuesta Kairos');
        expect(after.documents[0]?.accessKeyHash).not.toBeNull();
        expect(await activity(share.id)).toHaveLength(logged);
      },
    );

    it('answers 404 for an unknown link and 422 for a malformed body', async () => {
      await get(`${BASE}/missing`, 'owner').expect(404);
      await patch(`${BASE}/missing`, 'owner', {
        ...form(),
        locale: 'es',
        message: null,
        clientId: null,
        allowDownload: true,
        expiresAt: null,
        documents: [{ documentId: 'doc_a', versionId: null, requiresAccessKey: false }],
      }).expect(404);
      await post(`${BASE}/missing/revoke`, 'owner').expect(404);
      await get(`${BASE}/missing/access-log`, 'owner').expect(404);
      await post(BASE, 'owner', { title: 'x' }).expect(422);
    });
  });

  describe('listing, filters and the access log', () => {
    async function seedLinks() {
      clock.set('2026-10-01T12:00:00.000Z');
      const alfa = await created({
        title: 'Alfa',
        clientId: 'cli_k',
        documents: [{ documentId: 'doc_a', requiresAccessKey: true }, { documentId: 'doc_b' }],
      });
      clock.set('2026-10-10T12:00:00.000Z');
      const beta = await created({
        title: 'Beta',
        clientId: 'cli_s',
        expiresAt: '2026-10-15',
        documents: [{ documentId: 'doc_b' }],
      });
      clock.set('2026-10-20T12:00:00.000Z');
      const gamma = await created({ title: 'Gamma' });
      await post(`${BASE}/${gamma.share.id}/revoke`, 'owner').expect(200);
      clock.set('2026-10-30T12:00:00.000Z');
      return { alfa: alfa.share as Body, beta: beta.share as Body, gamma: gamma.share as Body };
    }
    const titles = (res: { body: Body }) => (res.body.items as Body[]).map((row) => row.title);

    it('lists newest first with the page envelope, status, counts and the client ref', async () => {
      await seedLinks();
      const res = await get(BASE, 'owner').expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
      expect(titles(res)).toEqual(['Gamma', 'Beta', 'Alfa']);
      expect(res.body.items.map((row: Body) => row.status)).toEqual([
        'REVOKED',
        'EXPIRED',
        'ACTIVE',
      ]);
      expect(res.body.items[2]).toMatchObject({
        documentCount: 2,
        protectedDocumentCount: 1,
        client: { id: 'cli_k', label: 'Kairos' },
        expiresAt: null,
        counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
        lastAccessedAt: null,
        createdBy: { name: 'owner' },
      });
    });

    it.each([
      ['status=ACTIVE', ['Alfa']],
      ['status=EXPIRED&status=REVOKED', ['Gamma', 'Beta']],
      ['clientId=cli_s', ['Beta']],
      ['documentId=doc_b', ['Beta', 'Alfa']],
      ['hasAccessKeys=true', ['Alfa']],
      ['hasAccessKeys=false', ['Gamma', 'Beta']],
      ['createdFrom=2026-10-10&createdTo=2026-10-10', ['Beta']],
      ['q=solaris', ['Beta']],
      ['q=alf', ['Alfa']],
      ['sort=title:asc', ['Alfa', 'Beta', 'Gamma']],
      ['sort=status:asc', ['Alfa', 'Beta', 'Gamma']],
      ['pageSize=25&page=2', []],
    ])('filters and sorts by %s', async (queryString, expected) => {
      await seedLinks();
      expect(titles(await get(`${BASE}?${queryString}`, 'owner').expect(200))).toEqual(expected);
    });

    it('answers 422 for a facet or a sort outside the whitelist', async () => {
      for (const bad of [
        'status=DELETED',
        'hasAccessKeys=maybe',
        'createdFrom=2026-02-31',
        'sort=token:asc',
      ]) {
        const res = await get(`${BASE}?${bad}`, 'owner').expect(422);
        expect(res.body.error.code).toBe('VALIDATION');
      }
    });

    it('lists the access log with a 12-character visitor, never the hash, and filters it', async () => {
      const { alfa } = await seedLinks();
      const hash = `${'ab'.repeat(32)}`;
      await prisma.shareAccessLog.createMany({
        data: [
          {
            id: 'g1',
            shareLinkId: alfa.id,
            event: 'VIEW' as const,
            documentId: null,
            ipHash: hash,
            userAgent: 'UA',
          },
          {
            id: 'g2',
            shareLinkId: alfa.id,
            event: 'UNLOCK_FAILED' as const,
            documentId: 'doc_a',
            ipHash: hash,
            userAgent: null,
          },
          {
            id: 'g3',
            shareLinkId: alfa.id,
            event: 'DOWNLOAD' as const,
            documentId: 'doc_b',
            ipHash: 'c'.repeat(64),
            userAgent: 'UA',
          },
        ].map((row, index) => ({
          ...row,
          createdAt: new Date(Date.UTC(2026, 9, 28 + index, 15)),
        })),
      });

      const res = await get(`${BASE}/${alfa.id}/access-log`, 'owner').expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1 });
      expect(res.body.items.map((row: Body) => row.id)).toEqual(['g3', 'g2', 'g1']);
      expect(res.body.items[0]).toMatchObject({
        shareLinkId: alfa.id,
        event: 'DOWNLOAD',
        documentId: 'doc_b',
        documentTitle: 'Documento doc_b',
        visitor: 'cccccccccccc',
        userAgent: 'UA',
      });
      expect(res.body.items[2].visitor).toBe('abababababab');
      expect(JSON.stringify(res.body)).not.toContain('ab'.repeat(7));

      const ids = async (queryString: string) =>
        (
          (await get(`${BASE}/${alfa.id}/access-log?${queryString}`, 'owner').expect(200)).body
            .items as Body[]
        ).map((row) => row.id);
      expect(await ids('event=VIEW&event=DOWNLOAD')).toEqual(['g3', 'g1']);
      expect(await ids('documentId=doc_a')).toEqual(['g2']);
      expect(await ids('from=2026-10-29&to=2026-10-29')).toEqual(['g2']);
      expect(await ids('sort=event:asc')).toEqual(['g3', 'g2', 'g1']);
      await get(`${BASE}/${alfa.id}/access-log?event=LOGIN`, 'owner').expect(422);
    });

    it('shows the stored counters the portal writes and the unlocks counted from the log', async () => {
      const { alfa } = await seedLinks();
      await prisma.shareLink.update({
        where: { id: alfa.id },
        data: { viewCount: 4, downloadCount: 2, lastAccessedAt: new Date('2026-10-29T10:00:00Z') },
      });
      await prisma.shareAccessLog.createMany({
        data: [
          { shareLinkId: alfa.id, event: 'UNLOCK', documentId: 'doc_a', ipHash: 'a'.repeat(64) },
          {
            shareLinkId: alfa.id,
            event: 'UNLOCK_FAILED' as const,
            documentId: 'doc_a',
            ipHash: 'a'.repeat(64),
          },
          {
            shareLinkId: alfa.id,
            event: 'UNLOCK_FAILED' as const,
            documentId: 'doc_a',
            ipHash: 'a'.repeat(64),
          },
        ],
      });
      const detail = (await get(`${BASE}/${alfa.id}`, 'owner').expect(200)).body as Body;
      expect(detail).toMatchObject({
        counters: { viewCount: 4, downloadCount: 2, unlockCount: 1, failedUnlockCount: 2 },
        lastAccessedAt: '2026-10-29T10:00:00.000Z',
      });
      expect(detail.documents[0].counters).toEqual({
        viewCount: 0,
        downloadCount: 0,
        unlockCount: 1,
        failedUnlockCount: 2,
      });
    });
  });

  describe('the shared facet of the documents list (DT-141, choice 7)', () => {
    const sharedIds = async (value: 'true' | 'false') =>
      ((await get(`/api/v1/documents?shared=${value}`, 'owner').expect(200)).body.items as Body[])
        .map((row) => row.id)
        .sort();

    it('follows the derived status of the links: active, revoked and expired by date', async () => {
      const { share } = await created({ documents: [{ documentId: 'doc_a' }] });
      expect(await sharedIds('true')).toHaveLength(1);

      const other = (
        await created({ documents: [{ documentId: 'doc_b' }], expiresAt: '2026-10-30' })
      ).share as Body;
      expect(await sharedIds('true')).toHaveLength(2);
      const detail = (await get(`/api/v1/documents`, 'owner').expect(200)).body.items as Body[];
      expect(detail.filter((row) => row.isShared)).toHaveLength(2);

      // The day after the last valid day the link is EXPIRED by date, before any step marks it.
      clock.set('2026-10-31T12:00:00.000Z');
      expect(await sharedIds('true')).toHaveLength(1);
      expect((await get(`${BASE}/${other.id}`, 'owner').expect(200)).body.status).toBe('EXPIRED');

      await post(`${BASE}/${share.id}/revoke`, 'owner').expect(200);
      expect(await sharedIds('true')).toHaveLength(0);
      expect(await sharedIds('false')).toHaveLength(3);
    });
  });

  describe('MarkExpiredShareLinks (DT-137, no route)', () => {
    const SYSTEM = { actorType: 'SYSTEM', userId: null } as const;

    it('marks expired links once, logs SYSTEM_JOB, and a renewed link is marked again when it next expires', async () => {
      const step = app.get(MarkExpiredShareLinks, { strict: false });
      const { share } = await created({ expiresAt: '2026-10-30' });
      const keep = (await created({ title: 'Sin vencimiento' })).share as Body;

      expect(await step.execute(SYSTEM)).toEqual({ updated: 0, shareLinkIds: [], skippedIds: [] });

      // Five days later the link is EXPIRED by date; the step marks it and logs once, however late it runs.
      clock.set('2026-11-04T12:00:00.000Z');
      expect((await get(`${BASE}/${share.id}`, 'owner').expect(200)).body.status).toBe('EXPIRED');
      expect(
        (await prisma.shareLink.findUniqueOrThrow({ where: { id: share.id } })).expiredAt,
      ).toBeNull();

      expect(await step.execute(SYSTEM)).toEqual({
        updated: 1,
        shareLinkIds: [share.id],
        skippedIds: [],
      });
      expect(
        (await prisma.shareLink.findUniqueOrThrow({ where: { id: share.id } })).expiredAt,
      ).not.toBeNull();
      expect(await step.execute(SYSTEM)).toMatchObject({ updated: 0 });
      const jobs = (await activity(share.id)).filter((entry) => entry.action === 'SYSTEM_JOB');
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        actorType: 'SYSTEM',
        actorId: null,
        metadata: { expiresAt: '2026-10-30' },
      });
      expect(await activity(keep.id)).toHaveLength(1);

      // Renewing the link clears the marker (A6), so the next expiry is marked and logged again.
      await patch(
        `${BASE}/${share.id}`,
        'owner',
        editOf(share, { expiresAt: '2026-11-10' }),
      ).expect(200);
      expect(
        (await prisma.shareLink.findUniqueOrThrow({ where: { id: share.id } })).expiredAt,
      ).toBeNull();
      expect((await get(`${BASE}/${share.id}`, 'owner').expect(200)).body.status).toBe('ACTIVE');
      clock.set('2026-11-12T12:00:00.000Z');
      expect(await step.execute(SYSTEM)).toMatchObject({ updated: 1, shareLinkIds: [share.id] });
      expect(
        (await activity(share.id)).filter((entry) => entry.action === 'SYSTEM_JOB'),
      ).toHaveLength(2);
    });

    it('is not reachable from a person: only the SYSTEM actor runs it', async () => {
      const step = app.get(MarkExpiredShareLinks, { strict: false });
      await expect(
        step.execute({ actorType: 'USER', userId: users['owner']?.userId ?? null }),
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
