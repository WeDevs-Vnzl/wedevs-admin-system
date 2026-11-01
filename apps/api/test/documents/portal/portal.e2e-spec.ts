import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeShareSecrets } from '../../../src/modules/documents/infrastructure/node-share-secrets';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { TEST_ENV } from '../../support/test-env';
import { createPortalApp } from './app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const PORTAL = '/api/v1/portal';
const T0 = '2026-10-30T12:00:00.000Z';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The C22 headers every portal response carries, errors included. */
const C22 = {
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'cache-control': 'private, no-store',
};
const expectC22 = (res: request.Response) => {
  for (const [name, value] of Object.entries(C22)) expect(res.headers[name]).toBe(value);
};

describe('public portal (e2e): HU-22 CA2-CA7, DT-45, C22, C24', () => {
  const prisma = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));
  const authenticator = new FakeAuthenticator();
  const storage = new InMemoryFileStorage();
  const clock = new FixedClock(T0);
  let app: NestExpressApplication;
  let owner: string;
  let ownerUser: CurrentUser;

  beforeAll(async () => {
    app = await createPortalApp({ authenticator, storage, clock });
  });

  beforeEach(async () => {
    clock.set(T0);
    await truncateBusinessTables(prisma);
    const row = await prisma.user.create({
      data: { clerkId: 'clerk_owner', email: 'owner@example.test', name: 'owner', role: 'OWNER' },
    });
    ownerUser = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'OWNER',
      email: row.email,
      name: row.name,
    };
    owner = authenticator.issue(ownerUser);
    await prisma.client.create({
      data: {
        id: 'cli_k',
        code: 'CLI-0001',
        tradeName: 'Kairos Studio',
        kind: 'EMPRESA',
        legalName: 'Kairos SA',
        taxId: 'J-1',
        country: 'VE',
        address: 'x',
        phone: '1',
      },
    });
    await prisma.file.create({
      data: {
        id: 'fil_c',
        storageKey: 'documents/2026/10/fil_c',
        bucket: 'memory',
        originalName: 'contrato firmado.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        status: 'READY',
        uploadedById: row.id,
      },
    });
    const docs: [string, 'MARKDOWN' | 'ARCHIVO' | 'ENLACE', number][] = [
      ['doc_contrato', 'ARCHIVO', 1],
      ['doc_prd', 'MARKDOWN', 2],
      ['doc_cred', 'ENLACE', 1],
      ['doc_two', 'MARKDOWN', 1],
    ];
    for (const [id, format, versions] of docs) {
      await prisma.document.create({
        data: {
          id,
          code: `DOC-${id}`,
          title: `Documento ${id}`,
          typeId: 'dtyp_nda',
          status: 'APROBADO',
          createdById: row.id,
        },
      });
      for (let n = 1; n <= versions; n += 1) {
        await prisma.documentVersion.create({
          data: {
            id: `${id}_v${n}`,
            documentId: id,
            versionNumber: n,
            format,
            content: format === 'MARKDOWN' ? `# ${id} v${n}` : null,
            fileId: format === 'ARCHIVO' ? 'fil_c' : null,
            url: format === 'ENLACE' ? 'https://creds.example.test/vault' : null,
            createdAt: new Date(`2026-10-0${n}T15:00:00.000Z`),
            createdById: row.id,
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
  const manage = (path: string) =>
    http().get(`/api/v1/share-links${path}`).set('Authorization', `Bearer ${owner}`);
  /** Creates a link through the management API; returns its token, id and the generated keys. */
  async function link(over: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/share-links')
      .set('Authorization', `Bearer ${owner}`)
      .send({
        title: 'Entrega de documentación',
        clientId: 'cli_k',
        documents: [
          { documentId: 'doc_contrato' },
          { documentId: 'doc_prd' },
          { documentId: 'doc_cred', requiresAccessKey: true },
        ],
        ...over,
      })
      .expect(201);
    const body = res.body as Body;
    return {
      token: body.share.token as string,
      id: body.share.id as string,
      key: (body.generatedKeys[0]?.accessKey ?? '') as string,
    };
  }
  const get = (path: string, cookie?: string) => {
    const req = http().get(path);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const unlock = (token: string, documentId: string, key: string, cookie?: string) => {
    const req = http().post(`${PORTAL}/${token}/documents/${documentId}/unlock`);
    return (cookie ? req.set('Cookie', cookie) : req).send({ key });
  };
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
  const pair = (setCookie: string) => setCookie.split(';')[0] ?? '';
  const logs = (shareLinkId: string) =>
    prisma.shareAccessLog.findMany({ where: { shareLinkId }, orderBy: { createdAt: 'asc' } });

  describe('HU-22 CA2: without a session, only the documents of the link', () => {
    it('resolves the page with no Authorization header, no side effect and the C22 headers', async () => {
      const { token, id } = await link();
      const res = await get(`${PORTAL}/${token}`).expect(200);
      expectC22(res);
      expect(res.body).toEqual({
        title: 'Entrega de documentación',
        message: null,
        locale: 'es',
        allowDownload: true,
        clientName: 'Kairos Studio',
        expiresAt: null,
        documents: [
          expect.objectContaining({ documentId: 'doc_contrato', locked: false, format: 'ARCHIVO' }),
          expect.objectContaining({
            documentId: 'doc_prd',
            locked: false,
            versionNumber: 2,
            format: 'MARKDOWN',
          }),
          expect.objectContaining({ documentId: 'doc_cred', locked: true, format: 'ENLACE' }),
        ],
      });
      expect(Object.keys(res.body.documents[0]).sort()).toEqual([
        'documentId',
        'format',
        'locked',
        'title',
        'typeName',
        'typeNameEn',
        'versionDate',
        'versionNumber',
      ]);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/scrypt|accessKey|ipHash|storageKey|fil_c|owner|clerk/);
      expect(await logs(id)).toEqual([]);
      expect(await prisma.shareLink.findUniqueOrThrow({ where: { id } })).toMatchObject({
        viewCount: 0,
        downloadCount: 0,
        lastAccessedAt: null,
      });
    });

    it('serves only the documents of the link: another document is a bare 404', async () => {
      const { token } = await link();
      const res = await get(`${PORTAL}/${token}/documents/doc_two`).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      await get(`${PORTAL}/${token}/files/doc_two`).expect(404);
      await http().post(`${PORTAL}/${token}/views`).send({ documentId: 'doc_two' }).expect(404);
    });

    it('leaves out a document archived since, and answers 404 for it', async () => {
      const { token } = await link();
      await prisma.document.update({ where: { id: 'doc_prd' }, data: { deletedAt: new Date() } });
      const page = await get(`${PORTAL}/${token}`).expect(200);
      expect(page.body.documents.map((doc: Body) => doc.documentId)).toEqual([
        'doc_contrato',
        'doc_cred',
      ]);
      await get(`${PORTAL}/${token}/documents/doc_prd`).expect(404);
    });

    it('returns the raw markdown to the viewer and describes a file without its key', async () => {
      const { token } = await link();
      const md = await get(`${PORTAL}/${token}/documents/doc_prd`).expect(200);
      expectC22(md);
      expect(md.body).toMatchObject({
        document: { documentId: 'doc_prd', locked: false },
        content: { format: 'MARKDOWN', markdown: '# doc_prd v2' },
      });
      const file = await get(`${PORTAL}/${token}/documents/doc_contrato`).expect(200);
      expect(file.body.content).toEqual({
        format: 'ARCHIVO',
        fileName: 'contrato firmado.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        preview: 'pdf',
      });
      expect(JSON.stringify(file.body)).not.toMatch(/fil_c|storageKey|bucket/);
    });
  });

  describe('HU-22 CA3 and CA4: every refusal about the link is the same bare 404', () => {
    it('answers a token with one character changed exactly like an unknown token', async () => {
      const { token } = await link();
      const changed = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;
      const unknown = 'Z'.repeat(43);
      // The same request id on both, so the envelope (which echoes it) is comparable byte for byte.
      const one = await get(`${PORTAL}/${changed}`).set('X-Request-Id', 'request-0001');
      const other = await get(`${PORTAL}/${unknown}`).set('X-Request-Id', 'request-0001');
      expect(one.status).toBe(404);
      expectC22(one);
      expectC22(other);
      expect(one.body).toEqual(other.body);
      expect(one.body.error.code).toBe('NOT_FOUND');
    });

    it('answers a malformed token with the same 404, never VALIDATION', async () => {
      const res = await get(`${PORTAL}/short`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expectC22(res);
      await get(`${PORTAL}/${'ñ'.repeat(43)}`).expect(404);
    });

    it('answers revoked and expired links with the same body, an expired link with expiredAt still null included', async () => {
      const revoked = await link();
      const expired = await link({ expiresAt: '2026-10-31' });
      const live = await link();
      await http()
        .post(`/api/v1/share-links/${revoked.id}/revoke`)
        .set('Authorization', `Bearer ${owner}`)
        .send({})
        .expect(200);
      // 2026-11-01 00:00 in Caracas (UTC-4) is the day after the last valid day.
      clock.set('2026-11-01T04:00:00.000Z');
      expect(
        (await prisma.shareLink.findUniqueOrThrow({ where: { id: expired.id } })).expiredAt,
      ).toBeNull();

      const unknown = await get(`${PORTAL}/${'Z'.repeat(43)}`);
      const a = await get(`${PORTAL}/${revoked.token}`);
      const b = await get(`${PORTAL}/${expired.token}`);
      for (const res of [a, b]) {
        expect(res.status).toBe(404);
        expectC22(res);
        expect(res.body.error).toMatchObject({
          code: 'NOT_FOUND',
          message: unknown.body.error.message,
          fieldErrors: unknown.body.error.fieldErrors,
        });
      }
      // The live link is untouched by the clock jump (no expiry date).
      await get(`${PORTAL}/${live.token}`).expect(200);
      for (const token of [revoked.token, expired.token]) {
        await get(`${PORTAL}/${token}/documents/doc_prd`).expect(404);
        await get(`${PORTAL}/${token}/files/doc_prd`).expect(404);
        await http().post(`${PORTAL}/${token}/views`).send({}).expect(404);
        await unlock(token, 'doc_cred', 'ANY-KEY-LONG-ENOUGH').expect(404);
      }
    });

    it('serves a link through its last valid day', async () => {
      const { token } = await link({ expiresAt: '2026-10-31' });
      clock.set('2026-11-01T03:59:59.000Z');
      await get(`${PORTAL}/${token}`).expect(200);
    });
  });

  describe('HU-22 CA5: visits and downloads are logged and counted', () => {
    it('logs a VIEW with the salted IP hash and a capped user agent, and the detail shows the counters', async () => {
      const { token, id } = await link();
      clock.set('2026-10-30T13:00:00.000Z');
      const res = await http()
        .post(`${PORTAL}/${token}/views`)
        .set('User-Agent', 'u'.repeat(900))
        .send({})
        .expect(201);
      expect(res.body).toEqual({ recorded: true });
      expectC22(res);
      await http().post(`${PORTAL}/${token}/views`).send({ documentId: 'doc_prd' }).expect(201);

      const rows = await logs(id);
      expect(rows.map((row) => [row.event, row.documentId])).toEqual([
        ['VIEW', null],
        ['VIEW', 'doc_prd'],
      ]);
      expect(rows[0]?.userAgent).toHaveLength(512);
      expect(rows[0]?.createdAt.toISOString()).toBe('2026-10-30T13:00:00.000Z');
      const secrets = new NodeShareSecrets({
        unlockSecret: TEST_ENV['SHARE_UNLOCK_SECRET'] as string,
        ipSalt: TEST_ENV['SHARE_IP_SALT'] as string,
      });
      expect([secrets.hashIp('::ffff:127.0.0.1'), secrets.hashIp('127.0.0.1')]).toContain(
        rows[0]?.ipHash,
      );
      expect(rows[0]?.ipHash).not.toMatch(/127/);

      const detail = await manage(`/${id}`).expect(200);
      expect(detail.body.counters).toMatchObject({ viewCount: 2, downloadCount: 0 });
      expect(detail.body.lastAccessedAt).toBe('2026-10-30T13:00:00.000Z');
      expect(
        detail.body.documents.find((doc: Body) => doc.document.id === 'doc_prd').counters,
      ).toMatchObject({ viewCount: 1 });
    });

    it('answers FORBIDDEN to a VIEW of a locked document without its cookie: no row, no counter', async () => {
      const { token, id, key } = await link();
      const refused = await http()
        .post(`${PORTAL}/${token}/views`)
        .send({ documentId: 'doc_cred' })
        .expect(403);
      expect(refused.body.error.code).toBe('FORBIDDEN');
      expectC22(refused);
      expect(await logs(id)).toEqual([]);
      const detail = await manage(`/${id}`).expect(200);
      expect(detail.body.counters).toMatchObject({ viewCount: 0 });
      expect(detail.body.lastAccessedAt).toBeNull();

      const cookie = pair(cookieOf(await unlock(token, 'doc_cred', key).expect(200)));
      await http()
        .post(`${PORTAL}/${token}/views`)
        .set('Cookie', cookie)
        .send({ documentId: 'doc_cred' })
        .expect(201);
      expect((await logs(id)).map((row) => [row.event, row.documentId])).toEqual([
        ['UNLOCK', 'doc_cred'],
        ['VIEW', 'doc_cred'],
      ]);
    });

    it('does not let a visitor record a DOWNLOAD: the body cannot choose the event', async () => {
      const { token, id } = await link();
      await http().post(`${PORTAL}/${token}/views`).send({ event: 'DOWNLOAD' }).expect(201);
      expect((await logs(id)).map((row) => row.event)).toEqual(['VIEW']);
    });

    it('logs DOWNLOAD only for attachment and counts it in the detail', async () => {
      const { token, id } = await link();
      const inline = await get(`${PORTAL}/${token}/files/doc_prd?disposition=inline`).expect(200);
      expectC22(inline);
      expect(await logs(id)).toEqual([]);
      const download = await get(`${PORTAL}/${token}/files/doc_prd?disposition=attachment`).expect(
        200,
      );
      expectC22(download);
      expect((await logs(id)).map((row) => [row.event, row.documentId])).toEqual([
        ['DOWNLOAD', 'doc_prd'],
      ]);
      const detail = await manage(`/${id}`).expect(200);
      expect(detail.body.counters).toMatchObject({ viewCount: 0, downloadCount: 1 });
    });

    it('rejects a malformed documentId in the views body with 422', async () => {
      const { token } = await link();
      await http().post(`${PORTAL}/${token}/views`).send({ documentId: '../x' }).expect(422);
    });
  });

  describe('HU-22 CA6: pinned versus latest', () => {
    it('a version published later does not change a pinned link and changes a latest one', async () => {
      const pinned = await link({
        documents: [{ documentId: 'doc_prd', versionId: 'doc_prd_v1' }],
      });
      const latest = await link({ documents: [{ documentId: 'doc_prd' }] });
      expect(
        (await get(`${PORTAL}/${latest.token}/documents/doc_prd`).expect(200)).body.content
          .markdown,
      ).toBe('# doc_prd v2');
      await prisma.documentVersion.create({
        data: {
          id: 'doc_prd_v3',
          documentId: 'doc_prd',
          versionNumber: 3,
          format: 'MARKDOWN',
          content: '# doc_prd v3',
          createdById: ownerUser.userId,
        },
      });
      await prisma.document.update({
        where: { id: 'doc_prd' },
        data: { currentVersionId: 'doc_prd_v3' },
      });

      const pinnedView = await get(`${PORTAL}/${pinned.token}/documents/doc_prd`).expect(200);
      expect(pinnedView.body.content.markdown).toBe('# doc_prd v1');
      expect(pinnedView.body.document.versionNumber).toBe(1);
      const latestView = await get(`${PORTAL}/${latest.token}/documents/doc_prd`).expect(200);
      expect(latestView.body.content.markdown).toBe('# doc_prd v3');
      expect(latestView.body.document.versionNumber).toBe(3);
      expect(
        (await get(`${PORTAL}/${pinned.token}/files/doc_prd?disposition=attachment`)).headers[
          'content-disposition'
        ],
      ).toBe('attachment; filename="DOC-doc_prd-v1.md"');
    });
  });

  describe('HU-22 CA7 and the delivery headers (contract choices 8 and 9)', () => {
    it('sends X-Robots-Tag noindex on the page', async () => {
      const { token } = await link();
      const res = await get(`${PORTAL}/${token}`).expect(200);
      expect(res.headers['x-robots-tag']).toContain('noindex');
    });

    it('serves markdown as text/markdown with nosniff and a sandbox CSP', async () => {
      const { token } = await link();
      const res = await get(`${PORTAL}/${token}/files/doc_prd?disposition=attachment`).expect(200);
      expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="DOC-doc_prd-v2.md"');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe('sandbox');
      expect(res.text).toBe('# doc_prd v2');
      const inline = await get(`${PORTAL}/${token}/files/doc_prd`).expect(200);
      expect(inline.headers['content-disposition']).toMatch(/^inline;/);
    });

    it('redirects a file with 302 to a URL signed for 5 minutes, per click, with the C22 headers', async () => {
      const { token } = await link();
      clock.set('2026-10-30T12:00:00.000Z');
      const res = await get(`${PORTAL}/${token}/files/doc_contrato?disposition=attachment`).expect(
        302,
      );
      expectC22(res);
      const url = new URL(res.headers['location'] as string);
      expect(url.origin + url.pathname).toBe(
        'https://storage.test/download/documents/2026/10/fil_c',
      );
      expect(url.searchParams.get('exp')).toBe(String(Date.parse(T0) + 300_000));
      expect(url.searchParams.get('name')).toBe('contrato firmado.pdf');
      expect(url.searchParams.get('disposition')).toBeNull();

      clock.advance(120_000);
      const second = await get(`${PORTAL}/${token}/files/doc_contrato?disposition=inline`).expect(
        302,
      );
      const inline = new URL(second.headers['location'] as string);
      expect(inline.searchParams.get('exp')).toBe(String(Date.parse(T0) + 420_000));
      expect(inline.searchParams.get('disposition')).toBe('inline');
    });

    it('redirects a link document to its stored http(s) URL', async () => {
      const { token, key } = await link();
      const cookie = pair(cookieOf(await unlock(token, 'doc_cred', key).expect(200)));
      const res = await get(
        `${PORTAL}/${token}/files/doc_cred?disposition=attachment`,
        cookie,
      ).expect(302);
      expect(res.headers['location']).toBe('https://creds.example.test/vault');
      await prisma.documentVersion.update({
        where: { id: 'doc_cred_v1' },
        data: { url: 'javascript:alert(1)' },
      });
      await get(`${PORTAL}/${token}/files/doc_cred`, cookie).expect(404);
    });

    it('with allowDownload=false refuses attachment with 403 and still allows inline', async () => {
      const { token, id } = await link({ allowDownload: false });
      const refused = await get(`${PORTAL}/${token}/files/doc_prd?disposition=attachment`).expect(
        403,
      );
      expect(refused.body.error.code).toBe('FORBIDDEN');
      expectC22(refused);
      await get(`${PORTAL}/${token}/files/doc_prd?disposition=inline`).expect(200);
      await get(`${PORTAL}/${token}/files/doc_contrato?disposition=inline`).expect(302);
      expect(await logs(id)).toEqual([]);
    });

    it('answers an unknown disposition with 422 and the headers', async () => {
      const { token } = await link();
      const res = await get(`${PORTAL}/${token}/files/doc_prd?disposition=evil`).expect(422);
      expectC22(res);
    });
  });

  describe('DT-45 the key flow', () => {
    it('refuses a locked document with 403 on view and download, then walks the whole flow', async () => {
      const { token, id, key } = await link();
      for (const path of [
        `documents/doc_cred`,
        `files/doc_cred?disposition=inline`,
        `files/doc_cred?disposition=attachment`,
      ]) {
        const res = await get(`${PORTAL}/${token}/${path}`).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expectC22(res);
      }

      const wrong = await unlock(token, 'doc_cred', 'WRONG-KEY-0001').expect(401);
      expect(wrong.body.error.code).toBe('ACCESS_KEY_INVALID');
      expectC22(wrong);
      expect(wrong.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(await logs(id))).not.toContain('WRONG-KEY-0001');

      for (let n = 2; n <= 4; n += 1) {
        expect(
          (await unlock(token, 'doc_cred', `WRONG-KEY-000${n}`).expect(401)).body.error.code,
        ).toBe('ACCESS_KEY_INVALID');
      }
      const fifth = await unlock(token, 'doc_cred', 'WRONG-KEY-0005').expect(429);
      expect(fifth.body.error.code).toBe('ACCESS_KEY_LOCKED');
      expectC22(fifth);
      // The right key is refused during the lockout, and nothing more is counted.
      const locked = await unlock(token, 'doc_cred', key).expect(429);
      expect(locked.body.error.code).toBe('ACCESS_KEY_LOCKED');
      expect(locked.headers['set-cookie']).toBeUndefined();
      expect((await logs(id)).map((row) => row.event)).toEqual(Array(5).fill('UNLOCK_FAILED'));

      // After 15 minutes by the clock the right key works.
      clock.advance(15 * 60_000 + 1);
      const ok = await unlock(token, 'doc_cred', key).expect(200);
      expect(ok.body).toEqual({ documentId: 'doc_cred', unlocked: true });
      expectC22(ok);
      expect((await logs(id)).map((row) => row.event).slice(-1)).toEqual(['UNLOCK']);

      const setCookie = cookieOf(ok);
      expect(setCookie).toMatch(/^wd_portal_unlock=[A-Za-z0-9_.-]+;/);
      expect(setCookie).toContain(`Path=/api/v1/portal/${token}`);
      expect(setCookie).toContain('Max-Age=43200');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(ok.headers['set-cookie']).toHaveLength(1);

      const cookie = pair(setCookie);
      const page = await get(`${PORTAL}/${token}`, cookie).expect(200);
      expect(page.body.documents.map((doc: Body) => doc.locked)).toEqual([false, false, false]);
      const view = await get(`${PORTAL}/${token}/documents/doc_cred`, cookie).expect(200);
      expect(view.body.content).toEqual({
        format: 'ENLACE',
        url: 'https://creds.example.test/vault',
      });
      await get(`${PORTAL}/${token}/files/doc_cred?disposition=attachment`, cookie).expect(302);
      const detail = await manage(`/${id}`).expect(200);
      expect(detail.body.counters).toMatchObject({ unlockCount: 1, failedUnlockCount: 5 });
      expect(detail.body.counters.downloadCount).toBe(1);
    });

    it('lets the cookie expire after 12 hours', async () => {
      const { token, key } = await link();
      const cookie = pair(cookieOf(await unlock(token, 'doc_cred', key).expect(200)));
      clock.advance(12 * 3_600_000 - 1);
      await get(`${PORTAL}/${token}/documents/doc_cred`, cookie).expect(200);
      clock.advance(2);
      await get(`${PORTAL}/${token}/documents/doc_cred`, cookie).expect(403);
    });

    it('refuses a forged cookie, the cookie of another link and a cookie value altered by a character', async () => {
      const one = await link();
      const two = await link();
      const cookieTwo = pair(cookieOf(await unlock(two.token, 'doc_cred', two.key).expect(200)));
      const [name, value] = cookieTwo.split('=') as [string, string];
      const forged = `${name}=${value.split('.')[0]}.AAAAAAAA`;
      const altered = `${name}=${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`;
      for (const cookie of [cookieTwo, forged, altered, `${name}=garbage`]) {
        const res = await get(`${PORTAL}/${one.token}/documents/doc_cred`, cookie).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        await get(`${PORTAL}/${one.token}/files/doc_cred`, cookie).expect(403);
      }
    });

    it('never lets a body or query field mark a document as unlocked', async () => {
      const { token, id } = await link();
      await get(`${PORTAL}/${token}/documents/doc_cred?unlockedDocumentIds=doc_cred`).expect(403);
      await get(`${PORTAL}/${token}/documents/doc_cred`).set('X-Unlocked', 'doc_cred').expect(403);
      await http()
        .post(`${PORTAL}/${token}/views`)
        .send({ documentId: 'doc_cred', unlockedDocumentIds: ['doc_cred'] })
        .expect(403);
      await get(`${PORTAL}/${token}/documents/doc_cred`).expect(403);
      expect(await logs(id)).toEqual([]);
    });

    it('does not count a key outside 8-128 characters: 422 VALIDATION and no row', async () => {
      const { token, id } = await link();
      for (const key of ['short', ' 1234567 ', 'k'.repeat(129)]) {
        const res = await unlock(token, 'doc_cred', key).expect(422);
        expect(res.body.error.code).toBe('VALIDATION');
        expectC22(res);
      }
      expect(await logs(id)).toEqual([]);
    });

    it('answers a document without a key as unlocked with no log row and no cookie', async () => {
      const { token, id } = await link();
      const res = await unlock(token, 'doc_prd', 'ANY-KEY-LONG-ENOUGH').expect(200);
      expect(res.body).toEqual({ documentId: 'doc_prd', unlocked: true });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(await logs(id)).toEqual([]);
    });

    it('keeps the lockout per document and per visitor IP hash', async () => {
      const { token, key } = await link({
        documents: [
          { documentId: 'doc_cred', requiresAccessKey: true },
          { documentId: 'doc_two', requiresAccessKey: true },
        ],
      });
      for (let n = 1; n <= 5; n += 1) await unlock(token, 'doc_cred', `WRONG-KEY-000${n}`);
      await unlock(token, 'doc_cred', key).expect(429);
      // The other document of the link has its own counter (its key is different, so a wrong one is INVALID).
      await unlock(token, 'doc_two', 'WRONG-KEY-0001').expect(401);
    });

    it('does not let a regenerated key revoke an issued cookie before it expires (A4)', async () => {
      const { token, id, key } = await link();
      const cookie = pair(cookieOf(await unlock(token, 'doc_cred', key).expect(200)));
      await http()
        .post(`/api/v1/share-links/${id}/documents/doc_cred/access-key`)
        .set('Authorization', `Bearer ${owner}`)
        .send({ action: 'regenerate' })
        .expect(200);
      await get(`${PORTAL}/${token}/documents/doc_cred`, cookie).expect(200);
      await unlock(token, 'doc_cred', key).expect(401);
    });
  });

  describe('C24: the portal is the only public surface of the context', () => {
    it('keeps every management route behind authentication', async () => {
      const { id } = await link();
      await http().get('/api/v1/share-links').expect(401);
      await http().get(`/api/v1/share-links/${id}`).expect(401);
      await http().get(`/api/v1/share-links/${id}/access-log`).expect(401);
      await http().post(`/api/v1/share-links/${id}/revoke`).send({}).expect(401);
    });
  });
});
