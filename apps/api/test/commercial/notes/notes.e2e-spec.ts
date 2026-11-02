import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOpenApiDocument } from '../../../src/app.setup';
import { NotesModule } from '../../../src/modules/commercial/notes.module';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { FILE_STORAGE } from '../../../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { createTestApp } from '../../support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const BASE = '/api/v1/notes';
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('notes (e2e)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const storage = new InMemoryFileStorage();
  let app: NestExpressApplication;
  const users = {} as Record<string, CurrentUser>;
  const tokens: Record<string, string> = {};
  let clientId = '';
  let client2Id = '';
  let projectId = '';
  let tagId = '';

  async function user(role: UserRole, key: string): Promise<void> {
    const row = await prisma.user.create({
      data: { clerkId: `clerk_${key}`, email: `${key}@example.test`, name: key, role },
    });
    users[key] = { userId: row.id, clerkId: row.clerkId, role, email: row.email, name: row.name };
    tokens[key] = authenticator.issue(users[key]);
  }

  const client = (code: string, tradeName: string) =>
    prisma.client.create({
      data: {
        code,
        kind: 'EMPRESA',
        tradeName,
        legalName: `${tradeName} SA`,
        taxId: code,
        country: 'VE',
        address: 'x',
        phone: '1',
      },
    });

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
      modules: [NotesModule],
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
    await user('MEMBER', 'other');
    await user('VIEWER', 'viewer');
    clientId = (await client('CLI-0001', 'Kairos')).id;
    client2Id = (await client('CLI-0002', 'Solaris')).id;
    projectId = (
      await prisma.project.create({ data: { code: 'PRY-0001', name: 'Web', summary: 's' } })
    ).id;
    tagId = (await prisma.tag.create({ data: { name: 'Prioritario', color: '#112233' } })).id;
  });
  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(prisma);
    await prisma.$disconnect();
  });

  const http = () => request(app.getHttpServer());
  const as = (key: string) => `Bearer ${tokens[key]}`;
  const post = (path: string, key: string, body: unknown) =>
    http()
      .post(path)
      .set('Authorization', as(key))
      .send(body as object);
  const get = (path: string, key: string) => http().get(path).set('Authorization', as(key));
  const create = (key: string, over: Record<string, unknown> = {}) =>
    post(BASE, key, {
      title: 'Alcance',
      content: doc('Alcance acordado con el cliente'),
      links: [{ entityType: 'CLIENT', entityId: clientId }],
      ...over,
    });

  it('requires authentication on every route', async () => {
    await http().get(BASE).expect(401);
    await http().post(BASE).send({}).expect(401);
    await http().get(`${BASE}/x`).expect(401);
    await http().post(`${BASE}/x/archive`).expect(401);
  });

  it('HU-23 CA1-CA3: creates a note with author, tag, two attachments and two links, and indexes plain text', async () => {
    const a = await file('fil_a', 'member');
    const b = await file('fil_b', 'member');
    const res = await create('member', {
      title: null,
      content: doc('uno dos tres cuatro cinco seis siete'),
      links: [
        { entityType: 'CLIENT', entityId: clientId },
        { entityType: 'PROJECT', entityId: projectId },
      ],
      tagIds: [tagId],
      attachmentFileIds: [a, b],
    }).expect(201);

    expect(res.body).toMatchObject({
      title: null,
      contentText: 'uno dos tres cuatro cinco seis siete',
      author: { id: users.member?.userId, name: 'member' },
      pinned: false,
      archivedAt: null,
      tags: [{ id: tagId, name: 'Prioritario', color: '#112233' }],
    });
    expect(res.body.links.map((l: { type: string; id: string }) => `${l.type}:${l.id}`)).toEqual([
      `CLIENT:${clientId}`,
      `PROJECT:${projectId}`,
    ]);
    expect(res.body.attachments.map((f: { id: string }) => f.id).sort()).toEqual([a, b]);

    const entry = await prisma.searchEntry.findFirstOrThrow({
      where: { entityType: 'NOTE', entityId: res.body.id },
    });
    expect(entry).toMatchObject({
      title: 'uno dos tres cuatro cinco seis',
      body: 'uno dos tres cuatro cinco seis siete',
      archived: false,
    });

    const log = await prisma.activityLog.findMany({
      where: { entityType: 'NOTE', entityId: res.body.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((l) => l.action).sort()).toEqual(['CREATE', 'LINK', 'LINK']);
    expect(log.every((l) => l.clientId === clientId && l.actorId === users.member?.userId)).toBe(
      true,
    );
    const metrics = await prisma.clientMetrics.findUniqueOrThrow({ where: { clientId } });
    expect(metrics.lastActivityAt).not.toBeNull();
    expect(await prisma.tagAssignment.count({ where: { noteId: res.body.id } })).toBe(1);
  });

  it('serializes every EntityRef with code null when absent and a typed enum (api-contract.md §2)', async () => {
    const contact = await prisma.contact.create({
      data: { clientId, fullName: 'Ana Pérez', email: 'ana@example.test' },
    });
    const res = await create('member', {
      links: [
        { entityType: 'CLIENT', entityId: clientId },
        { entityType: 'CONTACT', entityId: contact.id },
        { entityType: 'PROJECT', entityId: projectId },
      ],
    }).expect(201);
    const byType = Object.fromEntries(
      res.body.links.map((l: { type: string; code: unknown }) => [l.type, l.code]),
    );
    expect(byType).toEqual({ CLIENT: 'CLI-0001', CONTACT: null, PROJECT: 'PRY-0001' });
    const listed = await get(`${BASE}?clientId=${clientId}`, 'member').expect(200);
    const contactRef = listed.body.items[0].links.find(
      (l: { type: string }) => l.type === 'CONTACT',
    );
    expect(contactRef).toHaveProperty('code', null);
    const doc = buildOpenApiDocument(app);
    const refs = JSON.stringify(doc.paths?.[`${BASE}/{id}/restore`]);
    expect(refs).toContain('#/components/schemas/EntityRef');
  });

  it('links a note to a client and a project at once (CA2) and lists it under both feeds', async () => {
    const res = await create('member', {
      links: [
        { entityType: 'PROJECT', entityId: projectId },
        { entityType: 'CLIENT', entityId: clientId },
      ],
    }).expect(201);
    for (const [entityType, entityId] of [
      ['CLIENT', clientId],
      ['PROJECT', projectId],
    ]) {
      const feed = await get(
        `${BASE}?entityType=${entityType}&entityId=${entityId}`,
        'viewer',
      ).expect(200);
      expect(feed.body.items.map((n: { id: string }) => n.id)).toEqual([res.body.id]);
    }
    const none = await get(`${BASE}?entityType=CLIENT&entityId=${client2Id}`, 'viewer').expect(200);
    expect(none.body.items).toEqual([]);
  });

  it('rejects <script> and onerror content with 422 and stores nothing', async () => {
    const script = await create('member', {
      content: { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] },
    }).expect(422);
    expect(script.body.error).toMatchObject({ code: 'VALIDATION' });
    expect(script.body.error.fieldErrors['content']).toBeDefined();
    const onerror = await create('member', {
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { fileId: 'fil_x', onerror: 'alert(1)' } }],
      },
    }).expect(422);
    expect(onerror.body.error.fieldErrors['content']).toBeDefined();
    await create('member', { content: doc('   ') }).expect(422);
    expect(await prisma.note.count()).toBe(0);
    expect(await prisma.searchEntry.count({ where: { entityType: 'NOTE' } })).toBe(0);
  });

  it('stores an image with an external src without the src, and attaches its file', async () => {
    const img = await file('fil_img', 'member');
    const res = await create('member', {
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'con imagen' }] },
          { type: 'image', attrs: { fileId: img, alt: 'logo', src: 'https://evil.example/x.png' } },
        ],
      },
    }).expect(201);
    expect(res.body.content.content[1]).toEqual({
      type: 'image',
      attrs: { fileId: img, alt: 'logo' },
    });
    expect(res.body.attachments.map((f: { id: string }) => f.id)).toEqual([img]);
    const stored = await prisma.note.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(JSON.stringify(stored.content)).not.toContain('evil.example');
  });

  it("answers 404 for another user's unattached file, a PENDING one and an unknown one, attaching nothing", async () => {
    const theirs = await file('fil_theirs', 'other');
    const pending = await file('fil_pending', 'member', 'PENDING');
    const note = (await create('member').expect(201)).body;
    for (const fileId of [theirs, pending, 'fil_missing']) {
      const res = await post(`${BASE}/${note.id}/attachments`, 'member', { fileId }).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    await create('member', { attachmentFileIds: [theirs] }).expect(404);
    expect(await prisma.noteAttachment.count()).toBe(0);
    expect(await prisma.note.count()).toBe(1);
  });

  it('attaches a READY file of the caller once and records UPLOAD', async () => {
    const f = await file('fil_ok', 'member');
    const note = (await create('member').expect(201)).body;
    const res = await post(`${BASE}/${note.id}/attachments`, 'member', { fileId: f }).expect(201);
    expect(res.body.attachments.map((x: { id: string }) => x.id)).toEqual([f]);
    await post(`${BASE}/${note.id}/attachments`, 'member', { fileId: f }).expect(201);
    const uploads = await prisma.activityLog.findMany({
      where: { entityId: note.id, action: 'UPLOAD' },
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.metadata).toEqual({ fileId: f, fileName: 'fil_ok.pdf' });
  });

  it('lets a Viewer download a note attachment (302, `read note`) but not an unattached file', async () => {
    const f = await file('fil_dl', 'member');
    const loose = await file('fil_loose', 'member');
    await create('member', { attachmentFileIds: [f] }).expect(201);
    const ok = await get(`/api/v1/files/${f}/download`, 'viewer').expect(302);
    expect(ok.headers.location).toBeTruthy();
    await get(`/api/v1/files/${loose}/download`, 'viewer').expect(404);
  });

  it('refuses a Viewer to create, update, pin, link or archive (403)', async () => {
    const note = (await create('member').expect(201)).body;
    await create('viewer').expect(403);
    await http()
      .patch(`${BASE}/${note.id}`)
      .set('Authorization', as('viewer'))
      .send({ content: doc('x') })
      .expect(403);
    await post(`${BASE}/${note.id}/pin`, 'viewer', { pinned: true }).expect(403);
    await post(`${BASE}/${note.id}/archive`, 'viewer', {}).expect(403);
    await get(`${BASE}/${note.id}`, 'viewer').expect(200);
  });

  it("Member archives another's note -> 403, their own -> 200; Admin archives any", async () => {
    const mine = (await create('member').expect(201)).body;
    const theirs = (await create('other').expect(201)).body;
    const denied = await post(`${BASE}/${theirs.id}/archive`, 'member', {}).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    expect(
      (await prisma.note.findUniqueOrThrow({ where: { id: theirs.id } })).deletedAt,
    ).toBeNull();

    const ok = await post(`${BASE}/${mine.id}/archive`, 'member', {}).expect(200);
    expect(ok.body).toMatchObject({ id: mine.id });
    expect(ok.body.archivedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    const row = await prisma.note.findUniqueOrThrow({ where: { id: mine.id } });
    expect(row.deletedById).toBe(users.member?.userId);
    expect(
      (
        await prisma.searchEntry.findFirstOrThrow({
          where: { entityType: 'NOTE', entityId: mine.id },
        })
      ).archived,
    ).toBe(true);
    expect(await prisma.activityLog.count({ where: { entityId: mine.id, action: 'DELETE' } })).toBe(
      1,
    );

    await post(`${BASE}/${theirs.id}/archive`, 'admin', {}).expect(200);
    await post(`${BASE}/${theirs.id}/archive`, 'admin', {}).expect(404);
  });

  it('hides archived notes from non-trash roles and shows them to Owner and Admin (C19)', async () => {
    const note = (await create('member').expect(201)).body;
    await post(`${BASE}/${note.id}/archive`, 'owner', {}).expect(200);
    await get(`${BASE}/${note.id}`, 'member').expect(404);
    await get(`${BASE}/${note.id}`, 'admin').expect(200);
    const asMember = await get(`${BASE}?archived=include`, 'member').expect(200);
    expect(asMember.body.items).toEqual([]);
    const asAdmin = await get(`${BASE}?archived=only`, 'admin').expect(200);
    expect(asAdmin.body.items.map((n: { id: string }) => n.id)).toEqual([note.id]);
    expect(asAdmin.body.items[0].archivedAt).not.toBeNull();
  });

  it('restores through /notes/:id/restore and through the trash; Members cannot', async () => {
    const a = (await create('member').expect(201)).body;
    const b = (await create('member').expect(201)).body;
    await post(`${BASE}/${a.id}/archive`, 'member', {}).expect(200);
    await post(`${BASE}/${b.id}/archive`, 'member', {}).expect(200);

    await post(`${BASE}/${a.id}/restore`, 'member', {}).expect(403);
    const restored = await post(`${BASE}/${a.id}/restore`, 'admin', {}).expect(200);
    expect(restored.body).toMatchObject({ type: 'NOTE', id: a.id, label: 'Alcance' });
    expect(restored.body.code).toBeNull();
    await post(`${BASE}/${a.id}/restore`, 'admin', {}).expect(404);

    const trash = await get('/api/v1/trash?entityType=NOTE', 'admin').expect(200);
    expect(trash.body.items.map((r: { entity: { id: string } }) => r.entity.id)).toEqual([b.id]);
    const viaTrash = await post('/api/v1/trash/restore', 'owner', {
      entityType: 'NOTE',
      entityId: b.id,
    }).expect(200);
    expect(viaTrash.body.entity).toMatchObject({ type: 'NOTE', id: b.id });
    expect(
      await prisma.activityLog.count({ where: { entityType: 'NOTE', action: 'RESTORE' } }),
    ).toBe(2);
    expect(
      (await prisma.searchEntry.findFirstOrThrow({ where: { entityType: 'NOTE', entityId: a.id } }))
        .archived,
    ).toBe(false);
    await get(`${BASE}/${a.id}`, 'member').expect(200);
  });

  it("updates, pins, links and unlinks with the mock's errors and activity", async () => {
    const note = (await create('member').expect(201)).body;
    const patch = await http()
      .patch(`${BASE}/${note.id}`)
      .set('Authorization', as('admin'))
      .send({ title: 'Nuevo', content: doc('otro contenido'), tagIds: [tagId] })
      .expect(200);
    expect(patch.body).toMatchObject({
      title: 'Nuevo',
      contentText: 'otro contenido',
      author: { id: users.member?.userId },
      tags: [{ id: tagId }],
    });
    const update = await prisma.activityLog.findFirstOrThrow({
      where: { entityId: note.id, action: 'UPDATE' },
    });
    expect(update.changes).toEqual({
      title: ['Alcance', 'Nuevo'],
      content: 'changed',
      tagIds: ['', 'Prioritario'],
    });
    expect(
      (
        await prisma.searchEntry.findFirstOrThrow({
          where: { entityType: 'NOTE', entityId: note.id },
        })
      ).body,
    ).toBe('otro contenido');

    expect(
      (await post(`${BASE}/${note.id}/pin`, 'member', { pinned: true }).expect(200)).body.pinned,
    ).toBe(true);

    const linked = await post(`${BASE}/${note.id}/links`, 'member', {
      entityType: 'PROJECT',
      entityId: projectId,
    }).expect(201);
    expect(linked.body.links).toHaveLength(2);
    const dup = await post(`${BASE}/${note.id}/links`, 'member', {
      entityType: 'PROJECT',
      entityId: projectId,
    }).expect(409);
    expect(dup.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'notes.errors.alreadyLinked',
      entity: { id: projectId, type: 'PROJECT' },
    });
    await post(`${BASE}/${note.id}/links`, 'member', {
      entityType: 'CLIENT',
      entityId: 'cli_missing',
    }).expect(404);
    await post(`${BASE}/${note.id}/links`, 'member', {
      entityType: 'DOCUMENT',
      entityId: 'doc_missing',
    }).expect(404);
    const invalidType = await post(`${BASE}/${note.id}/links`, 'member', {
      entityType: 'NOT_A_TYPE',
      entityId: 'doc_1',
    }).expect(422);
    expect(invalidType.body.error.fieldErrors).toEqual({
      entityType: ['validation.invalidOption'],
    });

    await post(`${BASE}/${note.id}/unlink`, 'member', {
      entityType: 'PROJECT',
      entityId: projectId,
    }).expect(200);
    const last = await post(`${BASE}/${note.id}/unlink`, 'member', {
      entityType: 'CLIENT',
      entityId: clientId,
    }).expect(409);
    expect(last.body.error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'notes.errors.lastLink',
    });
    await post(`${BASE}/${note.id}/unlink`, 'member', {
      entityType: 'CONTACT',
      entityId: 'con_x',
    }).expect(404);
    const actions = (
      await prisma.activityLog.findMany({
        where: { entityId: note.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((l) => l.action);
    expect(actions).toEqual(['CREATE', 'LINK', 'UPDATE', 'UPDATE', 'LINK', 'UNLINK']);
  });

  it('refuses a link to an archived client with 404', async () => {
    const note = (await create('member').expect(201)).body;
    await prisma.client.update({ where: { id: client2Id }, data: { deletedAt: new Date() } });
    await post(`${BASE}/${note.id}/links`, 'member', {
      entityType: 'CLIENT',
      entityId: client2Id,
    }).expect(404);
    await create('member', { links: [{ entityType: 'CLIENT', entityId: client2Id }] }).expect(404);
  });

  it('lets two concurrent unlinks remove only one of two links (row lock)', async () => {
    const note = (
      await create('member', {
        links: [
          { entityType: 'CLIENT', entityId: clientId },
          { entityType: 'PROJECT', entityId: projectId },
        ],
      }).expect(201)
    ).body;
    const unlink = (entityType: string, entityId: string) =>
      post(`${BASE}/${note.id}/unlink`, 'member', { entityType, entityId });
    const [one, two] = await Promise.all([
      unlink('CLIENT', clientId),
      unlink('PROJECT', projectId),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(await prisma.noteLink.count({ where: { noteId: note.id } })).toBe(1);
  });

  it('filters and searches the table over HTTP', async () => {
    const a = (
      await create('member', {
        title: 'Riesgo',
        content: doc('Integración de pagos'),
        tagIds: [tagId],
      }).expect(201)
    ).body;
    const b = (
      await create('other', {
        title: 'Minuta',
        pinned: true,
        links: [{ entityType: 'PROJECT', entityId: projectId }],
      }).expect(201)
    ).body;
    const ids = async (qs: string) =>
      (await get(`${BASE}?${qs}`, 'viewer').expect(200)).body.items.map(
        (n: { id: string }) => n.id,
      );
    expect(await ids(`authorId=${users.other?.userId}`)).toEqual([b.id]);
    expect(await ids(`tagId=${tagId}`)).toEqual([a.id]);
    expect(await ids('linkedEntityType=PROJECT')).toEqual([b.id]);
    expect(await ids('pinned=true')).toEqual([b.id]);
    expect(await ids('q=integracion')).toEqual([a.id]);
    expect((await ids('sort=pinned:desc'))[0]).toBe(b.id);
    const bad = await get(`${BASE}?entityType=CLIENT`, 'viewer').expect(422);
    expect(bad.body.error.fieldErrors).toEqual({ entityId: ['validation.required'] });
    await get(`${BASE}?sort=bogus:asc`, 'viewer').expect(422);
    await get(`${BASE}?createdFrom=2026-13-40`, 'viewer').expect(422);
  });

  it('tags a note through the tag endpoints (taggable resolver registered)', async () => {
    const note = (await create('member').expect(201)).body;
    await post('/api/v1/tags/assign', 'member', {
      entityType: 'NOTE',
      entityId: note.id,
      tagIds: [tagId],
    }).expect(200);
    expect(await prisma.tagAssignment.count({ where: { noteId: note.id } })).toBe(1);
    await post('/api/v1/tags/assign', 'viewer', {
      entityType: 'NOTE',
      entityId: note.id,
      tagIds: [tagId],
    }).expect(403);
  });

  it('documents every notes route in the OpenAPI document', () => {
    const paths = Object.keys(buildOpenApiDocument(app).paths ?? {}).filter((p) =>
      p.startsWith(BASE),
    );
    expect(paths.sort()).toEqual(
      [
        BASE,
        `${BASE}/{id}`,
        `${BASE}/{id}/archive`,
        `${BASE}/{id}/attachments`,
        `${BASE}/{id}/links`,
        `${BASE}/{id}/pin`,
        `${BASE}/{id}/restore`,
        `${BASE}/{id}/unlink`,
      ].sort(),
    );
  });
});
