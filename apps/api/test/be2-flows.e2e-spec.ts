import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../src/modules/identity/infrastructure/matrix-authorization';
import { FILE_STORAGE } from '../src/modules/platform/application/ports/file-storage.port';
import type { CurrentUser } from '../src/shared/application/current-user';
import { AUTHORIZATION } from '../src/shared/application/ports/tokens';
import type { UserRole } from '../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from './support/db';
import { FakeAuthenticator } from './support/fakes/fake-authenticator';
import { InMemoryFileStorage } from './support/fakes/in-memory-file-storage';
import { createTestApp } from './support/test-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const V1 = '/api/v1';
const SLUG = 'be2-flow-';
const REAL_PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const clientForm = (over: Record<string, unknown> = {}) => ({
  kind: 'EMPRESA',
  tradeName: 'Nube Austral',
  legalName: 'Nube Austral C.A.',
  taxId: 'J-40111222-3',
  country: 'VE',
  address: 'Av. Principal, Caracas',
  phone: '+584121234567',
  ...over,
});

/**
 * BE-2 user stories over the full `AppModule`: the real `MatrixAuthorization` and the real route guard,
 * with a fake identity provider and an in-memory file storage (package 4.1).
 */
describe('BE-2 flows (full app)', () => {
  const prisma = createTestPrisma();
  const authenticator = new FakeAuthenticator();
  const storage = new InMemoryFileStorage();
  const tokens = {} as Record<UserRole, string>;
  const users = {} as Record<UserRole, CurrentUser>;
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      authenticator,
      probes: false,
      overrides: [
        { token: AUTHORIZATION, useValue: new MatrixAuthorization() },
        { token: FILE_STORAGE, useValue: storage },
      ],
    });
  });

  beforeEach(async () => {
    await truncateBusinessTables(prisma);
    await prisma.technology.deleteMany({ where: { slug: { startsWith: SLUG } } });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await prisma.user.create({
        data: {
          clerkId: `user_flow_${role.toLowerCase()}`,
          email: `flow-${role.toLowerCase()}@example.test`,
          name: role,
          role,
        },
      });
      users[role] = {
        userId: row.id,
        clerkId: row.clerkId,
        role,
        email: row.email,
        name: row.name,
      };
      tokens[role] = authenticator.issue(users[role]);
    }
  });

  afterAll(async () => {
    await app.close();
    await truncateBusinessTables(prisma);
    await prisma.technology.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.$disconnect();
  });

  const call = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    role: UserRole,
    path: string,
  ) =>
    request(app.getHttpServer())
      [method](`${V1}${path}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
  const get = (role: UserRole, path: string) => call('get', role, path);
  const post = (role: UserRole, path: string, body: object = {}) =>
    call('post', role, path).send(body);
  const put = (role: UserRole, path: string, body: object) => call('put', role, path).send(body);
  const patch = (role: UserRole, path: string, body: object) =>
    call('patch', role, path).send(body);

  const newClient = async (over: Record<string, unknown> = {}) =>
    (await post('ADMIN', '/clients', clientForm(over)).expect(201)).body as {
      id: string;
      code: string;
    };
  const newContact = async (clientId: string, over: Record<string, unknown> = {}) =>
    (
      await post('ADMIN', `/clients/${clientId}/contacts`, {
        fullName: 'Ana Pérez',
        email: 'ana@example.test',
        ...over,
      }).expect(201)
    ).body as { id: string };
  const newProject = async (clientIds: string[], over: Record<string, unknown> = {}) =>
    (
      await post('ADMIN', '/projects', {
        name: 'Sitio web',
        summary: 'Sitio institucional',
        clients: clientIds.map((clientId) => ({ clientId })),
        ...over,
      }).expect(201)
    ).body as { id: string; code: string };
  const newNote = async (over: Record<string, unknown> = {}) =>
    (
      await post('MEMBER', '/notes', {
        title: 'Alcance',
        content: doc('Alcance acordado'),
        links: [],
        ...over,
      }).expect(201)
    ).body as { id: string };
  const newTechnology = async (key: string, active = true) =>
    (
      await post('ADMIN', '/technologies', {
        name: `Flow ${key}`,
        slug: `${SLUG}${key}`,
        category: 'BACKEND',
        active,
      }).expect(201)
    ).body as { id: string };

  it('HU-03 CA1-CA4: registers a client with CLI-0001, rejects a duplicate tax id, logs and indexes it', async () => {
    const invalid = await post('ADMIN', '/clients', clientForm({ legalName: ' ' })).expect(422);
    expect(invalid.body.error.fieldErrors.legalName).toEqual(['validation.required']);

    const created = await newClient();
    expect(created.code).toBe('CLI-0001');
    expect(
      await prisma.activityLog.count({
        where: { entityType: 'CLIENT', entityId: created.id, action: 'CREATE' },
      }),
    ).toBe(1);
    expect(
      await prisma.searchEntry.findUnique({
        where: { entityType_entityId: { entityType: 'CLIENT', entityId: created.id } },
      }),
    ).toMatchObject({ code: 'CLI-0001', archived: false });

    const dup = await post('ADMIN', '/clients', clientForm({ taxId: 'j401112223' })).expect(409);
    expect(dup.body.error).toMatchObject({
      code: 'CONFLICT',
      entity: { type: 'CLIENT', id: created.id, code: 'CLI-0001' },
    });
    await post('MEMBER', '/clients', clientForm({ taxId: 'J-1' })).expect(403);
  });

  it('HU-04 CA1-CA3: a contact needs e-mail or phone, one primary at a time, and is searchable', async () => {
    const client = await newClient();
    const none = await post('ADMIN', `/clients/${client.id}/contacts`, { fullName: 'Sin datos' });
    expect(none.status).toBe(422);

    const first = await newContact(client.id, { isPrimary: true });
    const second = await newContact(client.id, { fullName: 'Bruno', isPrimary: true });
    const primaries = await prisma.contact.findMany({
      where: { clientId: client.id, isPrimary: true },
    });
    expect(primaries.map((c) => c.id)).toEqual([second.id]);
    expect(first.id).not.toBe(second.id);
    expect(
      await prisma.searchEntry.count({ where: { entityType: 'CONTACT', archived: false } }),
    ).toBe(2);
    const typeahead = await get('MEMBER', `/contacts/search?clientId=${client.id}`).expect(200);
    expect(typeahead.body.map((r: { id: string }) => r.id)).toContain(first.id);
    for (const ref of typeahead.body) expect(ref.code).toBeNull();
  });

  it('HU-05 CA1-CA3: a project needs a client, takes a role and shows under each linked client', async () => {
    const a = await newClient({ taxId: 'J-30000000-1', tradeName: 'Alfa' });
    const b = await newClient({ taxId: 'J-30000000-2', tradeName: 'Beta' });
    const none = await post('ADMIN', '/projects', { name: 'X', summary: 'y', clients: [] }).expect(
      422,
    );
    expect(none.body.error.fieldErrors.clients).toEqual(['validation.required']);

    const created = await post('ADMIN', '/projects', {
      name: 'Plataforma',
      summary: 'Plataforma conjunta',
      clients: [{ clientId: a.id, role: 'Contratante' }, { clientId: b.id }],
    }).expect(201);
    expect(created.body.clients.map((c: { role: string | null }) => c.role)).toEqual([
      'Contratante',
      null,
    ]);
    for (const client of [a, b]) {
      const list = await get('ADMIN', `/projects?clientId=${client.id}`).expect(200);
      expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([created.body.id]);
    }
  });

  it('HU-06 CA1-CA3: the stack comes from active technologies and an in-use technology cannot be deleted', async () => {
    const next = await newTechnology('next');
    const rust = await newTechnology('rust');
    const old = await newTechnology('old', false);
    const client = await newClient();

    const inactive = await post('ADMIN', '/projects', {
      name: 'P',
      summary: 's',
      clients: [{ clientId: client.id }],
      technologyIds: [old.id],
    }).expect(422);
    expect(inactive.body.error.fieldErrors.technologyIds).toEqual([
      'projects.errors.technologyInactive',
    ]);

    const withNext = await newProject([client.id], { technologyIds: [next.id] });
    const withRust = await newProject([client.id], { name: 'Otro', technologyIds: [rust.id] });
    const filtered = await get('MEMBER', `/projects?technologyId=${next.id}`).expect(200);
    expect(filtered.body.items.map((p: { id: string }) => p.id)).toEqual([withNext.id]);

    // CA3 through the real TechnologyUsagePort binding to commercial.
    const listed = await get('MEMBER', `/technologies?q=Flow next`).expect(200);
    expect(listed.body.items[0]).toMatchObject({ id: next.id, usageCount: 1 });
    const locked = await call('delete', 'OWNER', `/technologies/${next.id}`).expect(409);
    expect(locked.body.error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'catalogs.technologies.errors.inUse',
    });

    // Archiving the only live project frees it: the delete detaches the archived project's stack.
    await post('ADMIN', `/projects/${withNext.id}/archive`, {}).expect(200);
    await call('delete', 'OWNER', `/technologies/${next.id}`).expect(200);
    expect(await prisma.technology.findUnique({ where: { id: next.id } })).toBeNull();
    const archivedDetail = await get('ADMIN', `/projects/${withNext.id}`).expect(200);
    expect(archivedDetail.body.stack).toEqual([]);

    const restored = await post('ADMIN', '/trash/restore', {
      entityType: 'PROJECT',
      entityId: withNext.id,
    }).expect(200);
    expect(restored.body.entity).toMatchObject({ type: 'PROJECT', id: withNext.id });
    const back = await get('ADMIN', `/projects/${withNext.id}`).expect(200);
    expect(back.body.stack).toEqual([]);
    expect(withRust.id).not.toBe(withNext.id);
  });

  it('HU-07 CA1-CA3: several repository links, a persisted reorder and a field error for a bad URL', async () => {
    const client = await newClient();
    const project = await newProject([client.id]);
    const saved = await put('MEMBER', `/projects/${project.id}/links`, {
      links: [
        { group: 'REPOSITORIO', label: 'Frontend', url: 'https://git.test/fe' },
        { group: 'REPOSITORIO', label: 'Backend', url: 'https://git.test/be' },
      ],
    }).expect(200);
    const [fe, be] = saved.body.links as { id: string }[];
    const reordered = await post('MEMBER', `/projects/${project.id}/links/reorder`, {
      group: 'REPOSITORIO',
      orderedLinkIds: [be?.id, fe?.id],
    }).expect(200);
    expect(reordered.body.links.map((l: { label: string }) => l.label)).toEqual([
      'Backend',
      'Frontend',
    ]);
    const stored = await get('VIEWER', `/projects/${project.id}`).expect(200);
    expect(stored.body.links.map((l: { label: string }) => l.label)).toEqual([
      'Backend',
      'Frontend',
    ]);
    const bad = await put('MEMBER', `/projects/${project.id}/links`, {
      links: [{ group: 'REPOSITORIO', label: 'Roto', url: 'not a url' }],
    }).expect(422);
    expect(bad.body.error.fieldErrors).toEqual({ 'links.0.url': ['validation.invalidFormat'] });
  });

  it('HU-08 CA1, CA2, CA4: status changes need their dates and log STATUS_CHANGE', async () => {
    const client = await newClient();
    const project = await newProject([client.id]);
    const setStatus = (body: object) => post('MEMBER', `/projects/${project.id}/status`, body);

    const noStart = await setStatus({ status: 'EN_CURSO' }).expect(422);
    expect(noStart.body.error.fieldErrors).toHaveProperty('startDate');
    await setStatus({ status: 'EN_CURSO', startDate: '2026-02-01' }).expect(200);
    const noEnd = await setStatus({ status: 'ENTREGADO' }).expect(422);
    expect(noEnd.body.error.fieldErrors).toHaveProperty('endDate');
    await setStatus({ status: 'ENTREGADO', endDate: '2026-03-01' }).expect(200);

    const entries = await prisma.activityLog.findMany({
      where: { entityType: 'PROJECT', entityId: project.id, action: 'STATUS_CHANGE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => e.changes)).toEqual([
      { status: ['PROPUESTA', 'EN_CURSO'], startDate: [null, '2026-02-01'] },
      { status: ['EN_CURSO', 'ENTREGADO'], endDate: [null, '2026-03-01'] },
    ]);
  });

  it('HU-23 CA1-CA3: a note with a real attachment flow, two links, tags and plain-text search', async () => {
    const client = await newClient();
    const project = await newProject([client.id]);
    const tag = await prisma.tag.create({ data: { name: 'Prioritario', color: '#112233' } });

    const intent = await post('MEMBER', '/files/upload-intent', {
      name: 'contrato.pdf',
      mime: 'application/pdf',
      size: 100,
      context: 'general',
    }).expect(201);
    const fileId = intent.body.fileId as string;
    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    storage.put(row.storageKey, REAL_PDF);
    await post('MEMBER', '/files', { fileId }).expect(201);

    const note = await post('MEMBER', '/notes', {
      title: 'Contrato firmado',
      content: doc('uno dos tres'),
      links: [
        { entityType: 'CLIENT', entityId: client.id },
        { entityType: 'PROJECT', entityId: project.id },
      ],
      tagIds: [tag.id],
    }).expect(201);
    expect(note.body.links.map((l: { type: string }) => l.type)).toEqual(['CLIENT', 'PROJECT']);
    expect(note.body.author).toMatchObject({ id: users.MEMBER.userId });

    const attached = await post('MEMBER', `/notes/${note.body.id}/attachments`, { fileId }).expect(
      201,
    );
    expect(attached.body.attachments.map((f: { id: string }) => f.id)).toEqual([fileId]);

    const entry = await prisma.searchEntry.findFirstOrThrow({
      where: { entityType: 'NOTE', entityId: note.body.id },
    });
    expect(entry.body).toBe('uno dos tres');

    // Download claim: a Viewer reads the attachment of a live note (`read note`).
    const download = await get('VIEWER', `/files/${fileId}/download`).redirects(0).expect(302);
    expect(download.headers.location).toContain(`https://storage.test/download/${row.storageKey}`);
    // An archived note stops granting the claim.
    await post('MEMBER', `/notes/${note.body.id}/archive`).expect(200);
    await get('VIEWER', `/files/${fileId}/download`).expect(404);
  });

  it('HU-28 CA1-CA2: archive hides, archived=only shows to Admin and the trash restores each type', async () => {
    const client = await newClient();
    const contact = await newContact(client.id);
    const project = await newProject([client.id]);
    const note = await newNote({ links: [{ entityType: 'CLIENT', entityId: client.id }] });

    await post('ADMIN', `/contacts/${contact.id}/archive`).expect(200);
    await post('ADMIN', `/projects/${project.id}/archive`, {}).expect(200);
    await post('MEMBER', `/notes/${note.id}/archive`).expect(200);
    await post('ADMIN', `/clients/${client.id}/archive`, { confirm: true }).expect(200);

    const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);
    expect(ids((await get('MEMBER', '/clients').expect(200)).body)).toEqual([]);
    expect(ids((await get('ADMIN', '/projects').expect(200)).body)).toEqual([]);
    expect(ids((await get('ADMIN', '/notes').expect(200)).body)).toEqual([]);
    expect(ids((await get('ADMIN', '/clients?archived=only').expect(200)).body)).toEqual([
      client.id,
    ]);
    expect(ids((await get('ADMIN', '/projects?archived=only').expect(200)).body)).toEqual([
      project.id,
    ]);
    expect(ids((await get('ADMIN', '/notes?archived=only').expect(200)).body)).toEqual([note.id]);
    expect(
      await prisma.searchEntry.count({ where: { archived: false, entityType: 'CLIENT' } }),
    ).toBe(0);

    // A client holding the same tax id blocks the client restore (CONFLICT), then yields.
    const holder = await newClient({ tradeName: 'Nuevo dueño' });
    const blocked = await post('ADMIN', '/trash/restore', {
      entityType: 'CLIENT',
      entityId: client.id,
    }).expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'CONFLICT',
      entity: { type: 'CLIENT', id: holder.id },
    });
    await post('ADMIN', `/clients/${holder.id}/archive`, { confirm: true }).expect(200);

    for (const [entityType, entityId] of [
      ['CLIENT', client.id],
      ['CONTACT', contact.id],
      ['PROJECT', project.id],
      ['NOTE', note.id],
    ] as const) {
      const restored = await post('ADMIN', '/trash/restore', { entityType, entityId }).expect(200);
      expect(restored.body.entity).toMatchObject({ type: entityType, id: entityId });
      expect(
        await prisma.activityLog.count({ where: { entityType, entityId, action: 'RESTORE' } }),
      ).toBe(1);
    }
    expect(ids((await get('MEMBER', '/clients').expect(200)).body)).toEqual([client.id]);
    await post('MEMBER', '/trash/restore', { entityType: 'NOTE', entityId: note.id }).expect(403);
  });

  it('HU-29 CA1-CA2: client and project updates log their diff and the activity log is read-only', async () => {
    const client = await newClient();
    const project = await newProject([client.id]);
    await patch(
      'ADMIN',
      `/clients/${client.id}`,
      clientForm({ tradeName: 'Nube Austral Pro' }),
    ).expect(200);
    await patch('ADMIN', `/projects/${project.id}`, {
      name: 'Sitio renovado',
      summary: 'Sitio institucional',
      clients: [{ clientId: client.id }],
    }).expect(200);

    const diff = async (entityType: string, entityId: string) => {
      const res = await get(
        'ADMIN',
        `/activity?entityType=${entityType}&entityId=${entityId}&action=UPDATE`,
      ).expect(200);
      return res.body.items[0].changes;
    };
    expect(await diff('CLIENT', client.id)).toEqual({
      tradeName: ['Nube Austral', 'Nube Austral Pro'],
    });
    expect(await diff('PROJECT', project.id)).toEqual({ name: ['Sitio web', 'Sitio renovado'] });

    const some = await get('ADMIN', '/activity').expect(200);
    const entryId = some.body.items[0].id as string;
    for (const method of ['patch', 'put', 'delete'] as const) {
      await call(method, 'OWNER', `/activity/${entryId}`).send({}).expect(404);
      await call(method, 'OWNER', '/activity').send({}).expect(404);
    }
    await get('MEMBER', '/activity').expect(403);
  });

  it('C13 and metrics: a Member sees null money on both lists and the client metrics follow the flows', async () => {
    const client = await newClient();
    const project = await newProject([client.id]);
    await newNote({ links: [{ entityType: 'CLIENT', entityId: client.id }] });

    const adminClients = await get('ADMIN', '/clients').expect(200);
    expect(adminClients.body.items[0]).toMatchObject({
      id: client.id,
      projectCount: 1,
    });
    expect(adminClients.body.items[0].totalInvoicedUsd).not.toBeNull();
    expect(adminClients.body.items[0].lastActivityAt).not.toBeNull();
    const memberClients = await get('MEMBER', '/clients').expect(200);
    expect(memberClients.body.items[0]).toMatchObject({
      totalInvoicedUsd: null,
      receivableUsd: null,
    });

    const adminProjects = await get('ADMIN', '/projects').expect(200);
    expect(adminProjects.body.items[0].contractedValueUsd).not.toBeNull();
    const memberProjects = await get('MEMBER', '/projects').expect(200);
    expect(memberProjects.body.items[0]).toMatchObject({
      id: project.id,
      contractedValueUsd: null,
      invoicedUsd: null,
      collectedUsd: null,
      toInvoiceUsd: null,
    });

    const metrics = await prisma.clientMetrics.findUniqueOrThrow({
      where: { clientId: client.id },
    });
    expect(metrics.projectCount).toBe(1);
    expect(metrics.lastActivityAt).not.toBeNull();
  });
});
