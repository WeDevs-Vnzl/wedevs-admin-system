import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RESTORE_HANDLER_REGISTRY } from '../../src/modules/platform/application/ports/restore-handler.port';
import type { RestoreHandlerRegistry } from '../../src/modules/platform/application/restore-handler.registry';
import { TrashModule } from '../../src/modules/platform/trash.module';
import type { CurrentUser } from '../../src/shared/application/current-user';
import type { UserRole } from '../../src/shared/domain/enums';
import { makeClient, makeNote, makeProject } from '../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { IntelligenceModule } from '../../src/modules/intelligence/intelligence.module';
import { CommercialModule } from '../../src/modules/commercial/commercial.module';
import { DocumentsModule } from '../../src/modules/documents/documents.module';
import { FinanceModule } from '../../src/modules/finance/finance.module';
import { IntegrationsModule } from '../../src/modules/integrations/integrations.module';
import { createTestApp } from '../support/test-app';
import { FakeRestoreHandler, trashPolicy } from './harness';

const db = createTestPrisma();

describe('trash (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let clients: FakeRestoreHandler;
  let notes: FakeRestoreHandler;
  const tokens: Partial<Record<UserRole, string>> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    app = await createTestApp({
      modules: [TrashModule],
      // The real restore handlers would collide with the fakes registered below.
      without: [
        CommercialModule,
        FinanceModule,
        DocumentsModule,
        IntelligenceModule,
        IntegrationsModule,
      ],
      authenticator,
      authorization: trashPolicy,
    });
    const registry = app.get<RestoreHandlerRegistry>(RESTORE_HANDLER_REGISTRY, { strict: false });
    clients = new FakeRestoreHandler('CLIENT', 'client');
    notes = new FakeRestoreHandler('NOTE', 'note');
    registry.register(clients);
    registry.register(notes);
  });
  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(db);
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await db.user.create({
        data: { clerkId: `clerk_trash_${role}`, email: `${role}@example.test`, name: role, role },
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
    const client = await makeClient(db);
    const project = await makeProject(db);
    const note = await makeNote(db);
    const at = new Date('2026-10-20T12:00:00Z');
    await db.client.update({ where: { id: client.id }, data: { deletedAt: at } });
    await db.project.update({ where: { id: project.id }, data: { deletedAt: at } });
    await db.note.update({ where: { id: note.id }, data: { deletedAt: at } });
    Object.assign(ids, { client: client.id, project: project.id, note: note.id });
    clients.archived.clear();
    clients.archived.add(client.id);
    clients.conflictWith = null;
    clients.calls.length = 0;
    notes.calls.length = 0;
  }, 60_000);

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const restore = (role: UserRole, body: unknown) =>
    request(app.getHttpServer())
      .post('/api/v1/trash/restore')
      .set('Authorization', as(role))
      .send(body as object);

  it('requires authentication', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/trash').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses Member and Viewer on list and restore (403) without calling a handler', async () => {
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      const list = await request(app.getHttpServer())
        .get('/api/v1/trash')
        .set('Authorization', as(role))
        .expect(403);
      expect(list.body.error.code).toBe('FORBIDDEN');
      await restore(role, { entityType: 'CLIENT', entityId: ids.client }).expect(403);
    }
    expect(clients.calls).toHaveLength(0);
  });

  it('lists only the registered types (an archived project stays hidden)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/trash')
      .set('Authorization', as('ADMIN'))
      .expect(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 25, pageCount: 1 });
    const types = res.body.items.map((row: { entity: { type: string } }) => row.entity.type).sort();
    expect(types).toEqual(['CLIENT', 'NOTE']);
    expect(res.body.items[0]).toMatchObject({
      deletedAt: '2026-10-20T12:00:00.000Z',
      deletedBy: null,
    });
    const filtered = await request(app.getHttpServer())
      .get('/api/v1/trash?entityType=NOTE&entityType=PROJECT&sort=label:asc')
      .set('Authorization', as('OWNER'))
      .expect(200);
    expect(filtered.body.items.map((row: { entity: { id: string } }) => row.entity.id)).toEqual([
      ids.note,
    ]);
  });

  it('rejects an invalid entityType or sort (422)', async () => {
    for (const query of ['entityType=NOPE', 'sort=bogus:asc', 'deletedFrom=2026-13-40']) {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/trash?${query}`)
        .set('Authorization', as('OWNER'));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });

  it('restores through the handler and answers the entity with restoredAt', async () => {
    const res = await restore('OWNER', { entityType: 'CLIENT', entityId: ids.client }).expect(200);
    expect(res.body.entity).toEqual({
      type: 'CLIENT',
      id: ids.client,
      label: `Label ${ids.client}`,
    });
    expect(new Date(res.body.restoredAt).toISOString()).toBe(res.body.restoredAt);
    expect(clients.calls).toHaveLength(1);
    expect(clients.calls[0]?.user.role).toBe('OWNER');
  });

  it('an unregistered type is 404 and a live or unknown id is the handler 404', async () => {
    const unregistered = await restore('OWNER', {
      entityType: 'PROJECT',
      entityId: ids.project,
    }).expect(404);
    expect(unregistered.body.error.code).toBe('NOT_FOUND');
    await restore('OWNER', { entityType: 'PAYMENT', entityId: 'x' }).expect(404);
    await restore('OWNER', { entityType: 'CLIENT', entityId: 'unknown' }).expect(404);
  });

  it('a handler CONFLICT propagates as 409 with the entity', async () => {
    clients.conflictWith = { type: 'CLIENT', id: 'cli_holder', code: 'CLI-9', label: 'Holder' };
    const res = await restore('ADMIN', { entityType: 'CLIENT', entityId: ids.client }).expect(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLICT',
      message: 'trash.errors.taxIdTaken',
      entity: { type: 'CLIENT', id: 'cli_holder', label: 'Holder' },
    });
  });

  it('rejects a malformed restore body (422)', async () => {
    for (const body of [{}, { entityType: 'BOGUS', entityId: 'x' }, { entityType: 'CLIENT' }]) {
      const res = await restore('OWNER', body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION');
    }
  });
});
