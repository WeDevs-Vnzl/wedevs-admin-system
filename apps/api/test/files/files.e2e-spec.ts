import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_STORAGE } from '../../src/modules/platform/application/ports/file-storage.port';
import { FILE_ACCESS_REGISTRY } from '../../src/modules/platform/application/ports/file-access.port';
import type { FileAccessRegistry } from '../../src/modules/platform/application/file-access.registry';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { FakeAuthorization } from '../support/fakes/fake-authorization';
import { InMemoryFileStorage } from '../support/fakes/in-memory-file-storage';
import { createTestApp } from '../support/test-app';

// Each test truncates every business table; that is slow on a busy local Postgres.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MB = 1024 * 1024;
// Real magic bytes: the e2e runs the real FileTypeSniffer.
const REAL_PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const REAL_EXE = new TextEncoder().encode('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff');

describe('files (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  // Q-BE1-3 matrix stand-in: the Viewer cannot create anything.
  const authorization = new FakeAuthorization({
    policy: (user, action) => !(user.role === 'VIEWER' && action !== 'read'),
  });
  const storage = new InMemoryFileStorage();
  let app: NestExpressApplication;
  let member: CurrentUser;
  let other: CurrentUser;
  let viewer: CurrentUser;
  let memberToken: string;
  let otherToken: string;
  let viewerToken: string;

  const user = async (role: CurrentUser['role'], tag: string): Promise<CurrentUser> => {
    const row = await prisma.user.create({
      data: { clerkId: `clerk_${tag}`, email: `${tag}@example.test`, name: tag, role },
    });
    return { userId: row.id, clerkId: row.clerkId, role, email: row.email, name: row.name };
  };

  beforeAll(async () => {
    app = await createTestApp({
      authenticator,
      authorization,
      overrides: [{ token: FILE_STORAGE, useValue: storage }],
    });
  });
  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    member = await user('MEMBER', 'member');
    other = await user('MEMBER', 'other');
    viewer = await user('VIEWER', 'viewer');
    memberToken = authenticator.issue(member);
    otherToken = authenticator.issue(other);
    viewerToken = authenticator.issue(viewer);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const intent = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/files/upload-intent').set('Authorization', `Bearer ${token}`).send(body);
  const confirm = (token: string, fileId: string) =>
    http().post('/api/v1/files').set('Authorization', `Bearer ${token}`).send({ fileId });

  async function pendingPdf(token = memberToken, ctx: 'general' | 'payment_receipt' = 'general') {
    const res = await intent(token, {
      name: 'contract.pdf',
      mime: 'application/pdf',
      size: 100,
      context: ctx,
    }).expect(201);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: res.body.fileId } });
    return { fileId: res.body.fileId as string, key: row.storageKey };
  }

  it('requires authentication on every route', async () => {
    await http().post('/api/v1/files/upload-intent').send({}).expect(401);
    await http().post('/api/v1/files').send({}).expect(401);
    await http().get('/api/v1/files/x/download').expect(401);
    await http().delete('/api/v1/files/x').expect(401);
  });

  it('intent -> confirm with a PDF head: READY with the real size and an UPLOAD activity', async () => {
    const res = await intent(memberToken, {
      name: 'contract.pdf',
      mime: 'application/pdf',
      size: 100,
      context: 'general',
    }).expect(201);
    expect(res.body).toMatchObject({ url: 'https://storage.test/upload' });
    const file = await prisma.file.findUniqueOrThrow({ where: { id: res.body.fileId } });
    expect(file).toMatchObject({
      status: 'PENDING',
      uploadedById: member.userId,
      bucket: 'memory',
    });
    expect(file.storageKey).toMatch(/^general\/\d{4}\/\d{2}\/./);
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);

    storage.put(file.storageKey, REAL_PDF);
    const ok = await confirm(memberToken, file.id).expect(201);
    expect(ok.body).toMatchObject({
      id: file.id,
      status: 'READY',
      sizeBytes: REAL_PDF.byteLength,
      mimeType: 'application/pdf',
      originalName: 'contract.pdf',
      uploadedById: member.userId,
    });

    const logs = await prisma.activityLog.findMany({
      where: { entityType: 'FILE', entityId: file.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'UPLOAD', actorId: member.userId });

    await confirm(memberToken, file.id).expect(201); // idempotent
    expect(await prisma.activityLog.count({ where: { entityId: file.id } })).toBe(1);
  });

  it('spoofed type (executable declared PDF) -> 422 and the asset is destroyed', async () => {
    const { fileId, key } = await pendingPdf();
    storage.put(key, REAL_EXE);
    const res = await confirm(memberToken, fileId).expect(422);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { mime: ['validation.file.typeNotAllowed'] },
    });
    expect(storage.has(key)).toBe(false);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.deletedAt).not.toBeNull();
    expect(await prisma.activityLog.count({ where: { entityId: fileId } })).toBe(0);
  });

  it('an 11 MB payment_receipt is refused at the intent (422) and at confirm', async () => {
    const res = await intent(memberToken, {
      name: 'r.pdf',
      mime: 'application/pdf',
      size: 11 * MB,
      context: 'payment_receipt',
    }).expect(422);
    expect(res.body.error.fieldErrors).toEqual({ size: ['validation.file.tooLarge'] });

    const { fileId, key } = await pendingPdf(memberToken, 'payment_receipt');
    storage.put(key, new Uint8Array(11 * MB));
    const late = await confirm(memberToken, fileId).expect(422);
    expect(late.body.error.fieldErrors).toEqual({ size: ['validation.file.tooLarge'] });
    expect(storage.has(key)).toBe(false);
  });

  it('rejects malformed bodies with 422 and field errors', async () => {
    const res = await intent(memberToken, {
      name: '../x',
      mime: 'a',
      size: 1.5,
      context: 'avatar',
    }).expect(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['context', 'name', 'size']);
  });

  it('gives a Viewer 403 on the intent and on confirm', async () => {
    await intent(viewerToken, {
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 1,
      context: 'general',
    }).expect(403);
    await confirm(viewerToken, 'whatever').expect(403);
    expect(await prisma.file.count()).toBe(0);
  });

  it('another user gets 404 on confirm, download and delete of an unattached file', async () => {
    const { fileId, key } = await pendingPdf();
    storage.put(key, REAL_PDF);
    await confirm(otherToken, fileId).expect(404);
    await confirm(memberToken, fileId).expect(201);

    await http()
      .get(`/api/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await http()
      .delete(`/api/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await http()
      .get('/api/v1/files/unknown-id/download')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(404);
  });

  it('download answers 302 to the signed URL for the uploader, without caching', async () => {
    const { fileId, key } = await pendingPdf();
    storage.put(key, REAL_PDF);
    await confirm(memberToken, fileId).expect(201);

    const res = await http()
      .get(`/api/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${memberToken}`)
      .redirects(0)
      .expect(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe(`https://storage.test/download/${key}`);
    expect(location.searchParams.get('name')).toBe('contract.pdf');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('a registered authenticated claim (company logo) opens the download to other users', async () => {
    const { fileId, key } = await pendingPdf();
    storage.put(key, REAL_PDF);
    await confirm(memberToken, fileId).expect(201);
    const registry = app.get<FileAccessRegistry>(FILE_ACCESS_REGISTRY);
    registry.register({
      resolve: (id) => Promise.resolve(id === fileId ? { kind: 'authenticated' } : null),
    });

    await http()
      .get(`/api/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${otherToken}`)
      .redirects(0)
      .expect(302);
    await http()
      .delete(`/api/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(409);
  });

  it('delete: the uploader removes an unattached file (204), asset destroyed, DELETE recorded', async () => {
    const { fileId, key } = await pendingPdf();
    storage.put(key, REAL_PDF);
    await confirm(memberToken, fileId).expect(201);

    await http()
      .delete(`/api/v1/files/${fileId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(204);

    expect(storage.has(key)).toBe(false);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.deletedAt).not.toBeNull();
    const actions = (await prisma.activityLog.findMany({ where: { entityId: fileId } })).map(
      (l) => l.action,
    );
    expect(actions.sort()).toEqual(['DELETE', 'UPLOAD']);
    await http()
      .get(`/api/v1/files/${fileId}/download`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(404);
  });

  it('confirm before the browser uploaded keeps the file PENDING (422)', async () => {
    const { fileId } = await pendingPdf();
    const res = await confirm(memberToken, fileId).expect(422);
    expect(res.body.error.fieldErrors).toEqual({ file: ['validation.file.notUploaded'] });
    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(row).toMatchObject({ status: 'PENDING', deletedAt: null });
  });
});
