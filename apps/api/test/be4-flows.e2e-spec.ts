import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../src/shared/application/current-user';
import { AUTHORIZATION } from '../src/shared/application/ports/tokens';
import type { UserRole } from '../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from './support/db';
import { FakeAuthenticator } from './support/fakes/fake-authenticator';
import { createTestApp } from './support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const V1 = '/api/v1';
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * BE-4 document flow over the full `AppModule` (package 5.1): the real `MatrixAuthorization` and route guard, a
 * fake identity provider. type -> markdown document linked to a client -> draft -> publish -> approve -> share
 * with a key -> portal unlock -> view -> download -> new version -> pinned link unchanged -> revoke -> 404,
 * asserting each step's state and activity or access log. Markdown only, so no file storage is involved.
 */
describe('BE-4 flows (full app)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const tokens = {} as Record<UserRole, string>;
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      authenticator,
      probes: false,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `user_be4_${role.toLowerCase()}`,
          email: `be4-${role.toLowerCase()}@example.test`,
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
  });

  afterAll(async () => {
    await truncateBusinessTables(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  const as = (
    method: 'get' | 'post' | 'put' | 'patch',
    role: UserRole,
    path: string,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())[method](`${V1}${path}`);
    return (method === 'get' ? req : req.send(body ?? {})).set(
      'Authorization',
      `Bearer ${tokens[role]}`,
    );
  };
  const portal = (path: string, cookie?: string) => {
    const req = request(app.getHttpServer()).get(`${V1}/portal/${path}`);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  const actions = async (entityType: string, entityId: string) =>
    (
      await prisma.activityLog.findMany({
        where: { entityType: entityType as never, entityId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((entry) => entry.action);
  const accessLog = async (shareLinkId: string) =>
    (
      await prisma.shareAccessLog.findMany({
        where: { shareLinkId },
        orderBy: { createdAt: 'asc' },
      })
    ).map((entry) => [entry.event, entry.documentId] as const);

  it('type -> document -> draft -> publish -> approve -> share with a key -> unlock -> view -> download -> v2 -> pinned link unchanged -> revoke -> 404', async () => {
    // Setup: a client, and a markdown document type in a seeded category.
    const client = (
      await as('post', 'ADMIN', '/clients', {
        kind: 'EMPRESA',
        tradeName: 'Nube Austral',
        legalName: 'Nube Austral C.A.',
        taxId: 'J-40111222-3',
        country: 'VE',
        address: 'Av. Principal, Caracas',
        phone: '+584121234567',
      }).expect(201)
    ).body as Body;
    const category = await prisma.documentCategory.findFirstOrThrow();

    // 1. Create the type (settings, Owner/Admin).
    const type = (
      await as('post', 'ADMIN', '/document-types', {
        categoryId: category.id,
        name: 'Propuesta técnica',
        nameEn: 'Technical proposal',
        defaultFormat: 'MARKDOWN',
      }).expect(201)
    ).body as Body;
    expect(await prisma.documentType.findUniqueOrThrow({ where: { id: type.id } })).toMatchObject({
      defaultFormat: 'MARKDOWN',
      active: true,
    });

    // 2. A Member creates a markdown document linked to the client: BORRADOR, no version yet.
    const doc = (
      await as('post', 'MEMBER', '/documents', {
        title: 'Propuesta Nube Austral',
        typeId: type.id,
        links: [{ entityType: 'CLIENT', entityId: client.id }],
      }).expect(201)
    ).body as Body;
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({
      status: 'BORRADOR',
      currentVersionId: null,
      draftContent: null,
      deletedAt: null,
    });
    expect(await prisma.documentLink.count({ where: { documentId: doc.id } })).toBe(1);
    expect(await actions('DOCUMENT', doc.id)).toEqual(['CREATE', 'LINK']);

    // 3. Save the draft: stored on the document, no version created.
    await as('put', 'MEMBER', `/documents/${doc.id}/draft`, {
      content: '# Propuesta\n\nborrador',
    }).expect(200);
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({
      draftContent: '# Propuesta\n\nborrador',
      currentVersionId: null,
    });
    expect(await prisma.documentVersion.count({ where: { documentId: doc.id } })).toBe(0);

    // 4. Publish the draft as version 1: the draft is cleared and v1 becomes current.
    await as('post', 'MEMBER', `/documents/${doc.id}/versions/publish`, {
      changelog: 'Primera',
    }).expect(201);
    const v1 = await prisma.documentVersion.findFirstOrThrow({
      where: { documentId: doc.id, versionNumber: 1 },
    });
    expect(v1).toMatchObject({ format: 'MARKDOWN', content: '# Propuesta\n\nborrador' });
    expect(await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({
      currentVersionId: v1.id,
      draftContent: null,
    });

    // 5. Review, then approve (BORRADOR -> EN_REVISION -> APROBADO).
    await as('post', 'MEMBER', `/documents/${doc.id}/status`, { status: 'EN_REVISION' }).expect(
      200,
    );
    await as('post', 'MEMBER', `/documents/${doc.id}/status`, { status: 'APROBADO' }).expect(200);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe(
      'APROBADO',
    );
    const logAfterApproval = await actions('DOCUMENT', doc.id);
    expect(logAfterApproval.filter((action) => action === 'STATUS_CHANGE')).toHaveLength(2);

    // A Member cannot share (PRD §4.3): FORBIDDEN, and nothing is created.
    await as('post', 'MEMBER', '/share-links', {
      title: 'Entrega',
      documents: [{ documentId: doc.id }],
    }).expect(403);
    expect(await prisma.shareLink.count()).toBe(0);

    // 6. Admin shares it twice: pinned to v1 with a key, and following the latest version.
    const pinned = (
      await as('post', 'ADMIN', '/share-links', {
        title: 'Entrega fijada',
        clientId: client.id,
        documents: [{ documentId: doc.id, versionId: v1.id, requiresAccessKey: true }],
      }).expect(201)
    ).body as Body;
    const key = pinned.generatedKeys[0].accessKey as string;
    expect(pinned.generatedKeys).toEqual([{ documentId: doc.id, accessKey: expect.any(String) }]);
    const latest = (
      await as('post', 'ADMIN', '/share-links', {
        title: 'Entrega al día',
        documents: [{ documentId: doc.id, versionId: null }],
      }).expect(201)
    ).body as Body;
    expect(latest.generatedKeys).toEqual([]);
    // DT-150: an omitted versionId pins the current version (v1 here), so v2 will not reach this link.
    const omitted = (
      await as('post', 'ADMIN', '/share-links', {
        title: 'Entrega implícita',
        documents: [{ documentId: doc.id }],
      }).expect(201)
    ).body as Body;
    expect(
      await prisma.shareLinkDocument.findFirstOrThrow({
        where: { shareLinkId: omitted.share.id },
      }),
    ).toMatchObject({ versionId: v1.id });
    const row = await prisma.shareLink.findUniqueOrThrow({ where: { id: pinned.share.id } });
    expect(row).toMatchObject({ viewCount: 0, downloadCount: 0, revokedAt: null });
    expect(await actions('SHARE_LINK', pinned.share.id)).toEqual(['SHARE_CREATE']);
    const stored = await prisma.shareLinkDocument.findFirstOrThrow({
      where: { shareLinkId: pinned.share.id },
    });
    expect(stored).toMatchObject({ versionId: v1.id });
    expect(stored.accessKeyHash).not.toContain(key);

    // 7. The portal page lists the document locked and logs nothing; no hash or key leaks.
    const token = pinned.share.token as string;
    const page = await portal(token).expect(200);
    expect(page.body.documents).toEqual([
      expect.objectContaining({ documentId: doc.id, locked: true, versionNumber: 1 }),
    ]);
    expect(JSON.stringify(page.body)).not.toMatch(new RegExp(`${key}|scrypt|Hash`));
    expect(await accessLog(pinned.share.id)).toEqual([]);

    // Unlock with the key: UNLOCK logged, signed cookie issued, content readable with it.
    const unlock = await request(app.getHttpServer())
      .post(`${V1}/portal/${token}/documents/${doc.id}/unlock`)
      .send({ key })
      .expect(200);
    expect(unlock.body).toEqual({ documentId: doc.id, unlocked: true });
    const cookie =
      ((unlock.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
    expect(await accessLog(pinned.share.id)).toEqual([['UNLOCK', doc.id]]);
    const read = await portal(`${token}/documents/${doc.id}`, cookie).expect(200);
    expect(read.body.content).toEqual({ format: 'MARKDOWN', markdown: '# Propuesta\n\nborrador' });

    // 8. View: VIEW logged and counted, lastAccessedAt set.
    await request(app.getHttpServer()).post(`${V1}/portal/${token}/views`).send({}).expect(201);
    expect(await accessLog(pinned.share.id)).toEqual([
      ['UNLOCK', doc.id],
      ['VIEW', null],
    ]);
    expect(
      await prisma.shareLink.findUniqueOrThrow({ where: { id: pinned.share.id } }),
    ).toMatchObject({
      viewCount: 1,
      downloadCount: 0,
    });

    // 9. Download as attachment: markdown file named after the code and version; DOWNLOAD logged and counted.
    const download = await portal(`${token}/files/${doc.id}?disposition=attachment`, cookie).expect(
      200,
    );
    expect(download.headers['content-type']).toMatch(/^text\/markdown; charset=utf-8/);
    expect(download.headers['content-disposition']).toContain(`${doc.code}-v1.md`);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.text).toBe('# Propuesta\n\nborrador');
    expect(await accessLog(pinned.share.id)).toEqual([
      ['UNLOCK', doc.id],
      ['VIEW', null],
      ['DOWNLOAD', doc.id],
    ]);
    expect(
      await prisma.shareLink.findUniqueOrThrow({ where: { id: pinned.share.id } }),
    ).toMatchObject({
      viewCount: 1,
      downloadCount: 1,
    });

    // 10. A new version (draft + publish): v2 is current, the pinned link still serves v1.
    await as('put', 'MEMBER', `/documents/${doc.id}/draft`, {
      content: '# Propuesta\n\nversión dos',
    }).expect(200);
    await as('post', 'MEMBER', `/documents/${doc.id}/versions/publish`, {}).expect(201);
    const v2 = await prisma.documentVersion.findFirstOrThrow({
      where: { documentId: doc.id, versionNumber: 2 },
    });
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).currentVersionId,
    ).toBe(v2.id);
    const stillV1 = await portal(`${token}/documents/${doc.id}`, cookie).expect(200);
    expect(stillV1.body.document.versionNumber).toBe(1);
    expect(stillV1.body.content.markdown).toBe('# Propuesta\n\nborrador');
    const followsLatest = await portal(`${latest.share.token}/documents/${doc.id}`).expect(200);
    expect(followsLatest.body.document.versionNumber).toBe(2);
    expect(followsLatest.body.content.markdown).toBe('# Propuesta\n\nversión dos');
    const stillPinned = await portal(`${omitted.share.token}/documents/${doc.id}`).expect(200);
    expect(stillPinned.body.document.versionNumber).toBe(1);

    // 11. Revoke: final. The portal answers a bare 404 from then on, counters and log unchanged.
    await as('post', 'ADMIN', `/share-links/${pinned.share.id}/revoke`).expect(200);
    expect(
      (await prisma.shareLink.findUniqueOrThrow({ where: { id: pinned.share.id } })).revokedAt,
    ).not.toBeNull();
    expect(await actions('SHARE_LINK', pinned.share.id)).toEqual(['SHARE_CREATE', 'SHARE_REVOKE']);
    const gone = await portal(token).expect(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
    await portal(`${token}/documents/${doc.id}`, cookie).expect(404);
    await portal(`${token}/files/${doc.id}?disposition=attachment`, cookie).expect(404);
    expect(await accessLog(pinned.share.id)).toHaveLength(3);
    expect(
      await prisma.shareLink.findUniqueOrThrow({ where: { id: pinned.share.id } }),
    ).toMatchObject({
      viewCount: 1,
      downloadCount: 1,
    });
    // The other link is untouched by the revoke.
    await portal(latest.share.token).expect(200);
  });
});
