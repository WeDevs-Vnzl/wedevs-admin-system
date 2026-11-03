import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { TAGGABLE_TARGET_REGISTRY } from '../../../src/modules/settings/application/ports/taggable-target.port';
import type { TaggableTargetRegistry } from '../../../src/modules/settings/application/taggable-target.registry';
import { TagsModule } from '../../../src/modules/settings/tags.module';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { AUTHORIZATION } from '../../../src/shared/application/ports/tokens';
import type { UserRole } from '../../../src/shared/domain/enums';
import { makeClient, makeProject } from '../../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { createTestApp } from '../../support/test-app';
import { FakeTaggableTargetResolver } from './fakes';

// Every test truncates the business tables; a shared box can be slow doing it.
vi.setConfig({ testTimeout: 30_000 });

const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

describe('tags (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let clients: FakeTaggableTargetResolver;
  let projects: FakeTaggableTargetResolver;
  const tokens: Partial<Record<UserRole, string>> = {};
  let clientId = '';
  let projectId = '';

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [TagsModule],
      authenticator,
      overrides: [{ token: AUTHORIZATION, useValue: new MatrixAuthorization() }],
    });
    // What `commercial` does in its own `onModuleInit` (wave 3): one resolver per owned entity type.
    const registry = app.get<TaggableTargetRegistry>(TAGGABLE_TARGET_REGISTRY);
    clients = new FakeTaggableTargetResolver('CLIENT', 'client');
    projects = new FakeTaggableTargetResolver('PROJECT', 'project');
    registry.register(clients);
    registry.register(projects);
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
    const client = await makeClient(admin);
    const project = await makeProject(admin);
    clientId = client.id;
    projectId = project.id;
    clients.add(clientId, 'Acme', clientId);
    projects.add(projectId, 'Web', clientId);
  }, 60_000);

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const http = () => request(app.getHttpServer());

  function createTag(role: UserRole, name: string, color = '#112233') {
    return http().post('/api/v1/tags').set('Authorization', as(role)).send({ name, color });
  }

  it('refuses unauthenticated calls with UNAUTHENTICATED', async () => {
    const res = await http().get('/api/v1/tags').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a tag (201) and lets every role read the catalog, with one CREATE entry', async () => {
    const created = await createTag('ADMIN', '  Cliente clave ').expect(201);
    expect(created.body).toMatchObject({ name: 'Cliente clave', color: '#112233', usageCount: 0 });
    expect(created.body.createdAt).toMatch(/Z$/);
    expect(await admin.activityLog.count({ where: { entityType: 'TAG', action: 'CREATE' } })).toBe(
      1,
    );

    const list = await http().get('/api/v1/tags').set('Authorization', as('VIEWER')).expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 25, pageCount: 1 });
    expect(list.body.items[0].id).toBe(created.body.id);
    const one = await http()
      .get(`/api/v1/tags/${created.body.id}`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(one.body.name).toBe('Cliente clave');
    await http().get('/api/v1/tags/missing').set('Authorization', as('VIEWER')).expect(404);
  });

  it('grants create to Member and refuses Viewer; validates the body (422)', async () => {
    await createTag('MEMBER', 'Por miembro').expect(201);
    const viewer = await createTag('VIEWER', 'Nope').expect(403);
    expect(viewer.body.error.code).toBe('FORBIDDEN');
    const bad = await createTag('ADMIN', 'ok', 'red').expect(422);
    expect(bad.body.error.fieldErrors.color).toEqual(['validation.invalidFormat']);
    const blank = await createTag('ADMIN', '   ').expect(422);
    expect(blank.body.error.fieldErrors.name).toEqual(['validation.required']);
  });

  it('answers 409 on a duplicate name (case-insensitive) pointing at the holder', async () => {
    const first = await createTag('ADMIN', 'Cliente clave').expect(201);
    const dup = await createTag('OWNER', 'CLIENTE CLAVE').expect(409);
    expect(dup.body.error).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: ['tags.errors.nameTaken'] },
      entity: { type: 'TAG', id: first.body.id, label: 'Cliente clave' },
    });
  });

  it('updates with the settings grant only (Admin yes, Member no) and logs the diff', async () => {
    const tag = (await createTag('OWNER', 'Alpha')).body;
    await http()
      .patch(`/api/v1/tags/${tag.id}`)
      .set('Authorization', as('MEMBER'))
      .send({ name: 'Nope' })
      .expect(403);
    const res = await http()
      .patch(`/api/v1/tags/${tag.id}`)
      .set('Authorization', as('ADMIN'))
      .send({ name: 'Beta', color: '#abcdef' })
      .expect(200);
    expect(res.body).toMatchObject({ name: 'Beta', color: '#abcdef' });
    const entries = await admin.activityLog.findMany({
      where: { action: 'UPDATE', entityType: 'TAG' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changes).toEqual({ name: ['Alpha', 'Beta'], color: ['#112233', '#abcdef'] });
    await http()
      .patch('/api/v1/tags/missing')
      .set('Authorization', as('ADMIN'))
      .send({ name: 'X' })
      .expect(404);
  });

  describe('assign and unassign', () => {
    const assign = (role: UserRole, body: object) =>
      http().post('/api/v1/tags/assign').set('Authorization', as(role)).send(body);

    it('refuses a Viewer (403) and a Member on a client (403), writing nothing', async () => {
      const tag = (await createTag('OWNER', 'Alpha')).body;
      const body = { entityType: 'CLIENT', entityId: clientId, tagIds: [tag.id] };
      expect((await assign('VIEWER', body).expect(403)).body.error.code).toBe('FORBIDDEN');
      expect((await assign('MEMBER', body).expect(403)).body.error.code).toBe('FORBIDDEN');
      expect(await admin.tagAssignment.count()).toBe(0);
      expect(await admin.activityLog.count({ where: { action: 'LINK' } })).toBe(0);
    });

    it('lets a Member tag a project', async () => {
      const tag = (await createTag('OWNER', 'Alpha')).body;
      await assign('MEMBER', {
        entityType: 'PROJECT',
        entityId: projectId,
        tagIds: [tag.id],
      }).expect(200);
    });

    it('lets an Admin assign: returns the chips, writes the row and one LINK with the clientId', async () => {
      const tag = (await createTag('OWNER', 'Alpha', '#0000AA')).body;
      const res = await assign('ADMIN', {
        entityType: 'CLIENT',
        entityId: clientId,
        tagIds: [tag.id],
      }).expect(200);
      expect(res.body).toEqual({ items: [{ id: tag.id, name: 'Alpha', color: '#0000AA' }] });

      const links = await admin.activityLog.findMany({ where: { action: 'LINK' } });
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        entityType: 'CLIENT',
        entityId: clientId,
        entityLabel: 'Acme',
        clientId,
        metadata: { tagId: tag.id, tagName: 'Alpha' },
      });

      // Assigning again is a no-op: same chips, no second entry.
      await assign('ADMIN', { entityType: 'CLIENT', entityId: clientId, tagIds: [tag.id] }).expect(
        200,
      );
      expect(await admin.activityLog.count({ where: { action: 'LINK' } })).toBe(1);

      // Usage follows live records; an archived client no longer counts.
      const usage = await http().get(`/api/v1/tags/${tag.id}`).set('Authorization', as('VIEWER'));
      expect(usage.body.usageCount).toBe(1);
      await admin.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
      const after = await http().get(`/api/v1/tags/${tag.id}`).set('Authorization', as('VIEWER'));
      expect(after.body.usageCount).toBe(0);
    });

    it('answers 422 for an unknown entity type and for unknown tag ids, 404 for a missing document', async () => {
      const tag = (await createTag('OWNER', 'Alpha')).body;
      const res = await assign('ADMIN', {
        entityType: 'NOT_A_TYPE',
        entityId: 'x',
        tagIds: [tag.id],
      }).expect(422);
      expect(res.body.error.fieldErrors.entityType).toEqual(['validation.invalidOption']);
      await assign('ADMIN', { entityType: 'DOCUMENT', entityId: 'x', tagIds: [tag.id] }).expect(
        404,
      );
      const unknown = await assign('ADMIN', {
        entityType: 'CLIENT',
        entityId: clientId,
        tagIds: ['tag_missing'],
      }).expect(422);
      expect(unknown.body.error.fieldErrors.tagIds).toEqual(['validation.invalidOption']);
      await assign('ADMIN', { entityType: 'CLIENT', entityId: clientId, tagIds: [] }).expect(422);
    });

    it('answers 404 for an unknown or archived record', async () => {
      const tag = (await createTag('OWNER', 'Alpha')).body;
      await assign('ADMIN', { entityType: 'CLIENT', entityId: 'nope', tagIds: [tag.id] }).expect(
        404,
      );
      clients.archive(clientId);
      await assign('ADMIN', { entityType: 'CLIENT', entityId: clientId, tagIds: [tag.id] }).expect(
        404,
      );
    });

    it('unassigns one tag, returns the remaining chips and logs one UNLINK', async () => {
      const a = (await createTag('OWNER', 'Alpha')).body;
      const b = (await createTag('OWNER', 'Beta')).body;
      await assign('ADMIN', {
        entityType: 'PROJECT',
        entityId: projectId,
        tagIds: [a.id, b.id],
      }).expect(200);
      const send = (role: UserRole, tagId: string) =>
        http()
          .post('/api/v1/tags/unassign')
          .set('Authorization', as(role))
          .send({ entityType: 'PROJECT', entityId: projectId, tagId });
      await send('VIEWER', a.id).expect(403);
      const res = await send('MEMBER', a.id).expect(200);
      expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([b.id]);
      expect(await admin.activityLog.count({ where: { action: 'UNLINK', clientId } })).toBe(1);
      // Removing a tag that is not assigned: no entry.
      await send('MEMBER', a.id).expect(200);
      expect(await admin.activityLog.count({ where: { action: 'UNLINK' } })).toBe(1);
    });
  });

  it('filters the list by entity type', async () => {
    const a = (await createTag('OWNER', 'Alpha')).body;
    await createTag('OWNER', 'Beta');
    await http()
      .post('/api/v1/tags/assign')
      .set('Authorization', as('ADMIN'))
      .send({ entityType: 'PROJECT', entityId: projectId, tagIds: [a.id] })
      .expect(200);
    const res = await http()
      .get('/api/v1/tags?entityType=PROJECT&sort=usageCount:desc')
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
    await http().get('/api/v1/tags?sort=bogus:asc').set('Authorization', as('VIEWER')).expect(422);
  });
});
