import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TechnologiesModule } from '../../../src/modules/settings/technologies.module';
import { TECHNOLOGY_USAGE } from '../../../src/modules/settings/application/ports/technology-usage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { createTestApp } from '../../support/test-app';
import { FakeTechnologyUsage } from './fakes/fake-technology-usage';
import { settingsPolicy } from './fakes/world';

const BASE = '/api/v1/technologies';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** Every technology this file creates has a slug starting with `e2e-`; the seeded catalog is kept. */
const E2E = 'e2e-';

/**
 * The suite is slow on a loaded machine (every request is a real database round trip through the app),
 * so its hooks and tests share a generous budget. Users are created once: they are the actors the
 * activity rows point at, and a per-test truncate would race with the requests still in flight.
 */
describe('technologies (e2e)', { timeout: 120_000 }, () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let usage: FakeTechnologyUsage;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    await truncateBusinessTables(admin);
    authenticator = new FakeAuthenticator();
    usage = new FakeTechnologyUsage();
    app = await createTestApp({
      modules: [TechnologiesModule],
      authenticator,
      authorization: settingsPolicy,
      overrides: [{ token: TECHNOLOGY_USAGE, useValue: usage }],
    });
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_tec_${role.toLowerCase()}`,
          email: `tec-${role.toLowerCase()}@example.test`,
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
    await app.close();
    await truncateBusinessTables(admin);
    await admin.technology.deleteMany({ where: { slug: { startsWith: E2E } } });
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await admin.technology.deleteMany({ where: { slug: { startsWith: E2E } } });
    usage.reset();
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;

  /** Creates a technology straight in the database, for the tests that start from a known row. */
  async function seedTechnology(suffix: string, overrides: { active?: boolean } = {}) {
    return admin.technology.create({
      data: {
        name: `E2E Tech ${suffix}`,
        slug: `${E2E}${suffix}`,
        category: 'BACKEND',
        active: overrides.active ?? true,
      },
    });
  }

  it('refuses an unauthenticated read with UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get(BASE).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('lets a Viewer read the catalog and one technology with its usage (DT-71)', async () => {
    const row = await seedTechnology('viewer');
    usage.setLiveProjects(row.id, 3);
    const list = await request(app.getHttpServer())
      .get(`${BASE}?q=E2E`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, pageSize: 25, pageCount: 1 });
    expect(list.body.items[0]).toEqual({
      id: row.id,
      name: 'E2E Tech viewer',
      nameEn: null,
      slug: 'e2e-viewer',
      category: 'BACKEND',
      iconSlug: null,
      color: null,
      active: true,
      usageCount: 3,
    });

    const one = await request(app.getHttpServer())
      .get(`${BASE}/${row.id}`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(one.body).toMatchObject({ id: row.id, usageCount: 3 });
  });

  it('answers NOT_FOUND for an unknown technology (404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/tec_missing_e2e`)
      .set('Authorization', as('VIEWER'))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lets an Admin create a technology: 201, the derived slug and one SETTINGS_CHANGE row', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', as('ADMIN'))
      .send({ name: 'E2E Odin', category: 'LENGUAJE' })
      .expect(201);
    expect(res.body).toMatchObject({
      name: 'E2E Odin',
      nameEn: null,
      slug: 'e2e-odin',
      category: 'LENGUAJE',
      active: true,
      usageCount: 0,
    });
    const entries = await admin.activityLog.findMany({
      where: { entityType: 'SETTING', entityId: res.body.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'SETTINGS_CHANGE', actorType: 'USER' });
  });

  it('answers CONFLICT with the name field when the name is taken, ignoring case (409)', async () => {
    await seedTechnology('taken');
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', as('OWNER'))
      .send({ name: 'e2e tech TAKEN', category: 'OTRO' })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { name: ['catalogs.technologies.errors.nameTaken'] },
    });
  });

  it('answers VALIDATION with the field key for a malformed slug (422)', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', as('OWNER'))
      .send({ name: 'E2E Slugged', slug: 'Not A Slug', category: 'OTRO' })
      .expect(422);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { slug: ['validation.invalidFormat'] },
    });
  });

  it('refuses a Member to create (FORBIDDEN, 403) and stores nothing', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('Authorization', as('MEMBER'))
      .send({ name: 'E2E Member', category: 'OTRO' })
      .expect(403);
    await expect(admin.technology.count({ where: { slug: 'e2e-member' } })).resolves.toBe(0);
  });

  it('updates every editable field; the name stays its own on update', async () => {
    const row = await seedTechnology('update');
    const res = await request(app.getHttpServer())
      .patch(`${BASE}/${row.id}`)
      .set('Authorization', as('OWNER'))
      .send({
        name: 'E2E Tech update',
        nameEn: 'Update',
        slug: 'e2e-update',
        category: 'IA',
        iconSlug: 'openai',
        color: '#10A37F',
        active: true,
      })
      .expect(200);
    expect(res.body).toMatchObject({ nameEn: 'Update', category: 'IA', color: '#10A37F' });
  });

  it('deactivates a technology: it leaves the active=true list and stays readable', async () => {
    const row = await seedTechnology('retired');
    await request(app.getHttpServer())
      .post(`${BASE}/${row.id}/active`)
      .set('Authorization', as('ADMIN'))
      .send({ active: false })
      .expect(200);
    const active = await request(app.getHttpServer())
      .get(`${BASE}?q=E2E&active=true`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(active.body.items.map((t: { id: string }) => t.id)).not.toContain(row.id);
    const inactive = await request(app.getHttpServer())
      .get(`${BASE}/${row.id}`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(inactive.body.active).toBe(false);
  });

  it('locks the delete of a technology in use by a live project (409 INTEGRITY_LOCK), row kept', async () => {
    const row = await seedTechnology('in-use');
    usage.setLiveProjects(row.id, 2);
    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${row.id}`)
      .set('Authorization', as('OWNER'))
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'catalogs.technologies.errors.inUse',
    });
    await expect(admin.technology.findUnique({ where: { id: row.id } })).resolves.not.toBeNull();
    expect(usage.detached).toEqual([]);
  });

  it('deletes an unused technology: 200 with its id, detaches archived projects, logs the removal', async () => {
    const row = await seedTechnology('unused');
    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${row.id}`)
      .set('Authorization', as('OWNER'))
      .expect(200);
    expect(res.body).toEqual({ id: row.id });
    await expect(admin.technology.findUnique({ where: { id: row.id } })).resolves.toBeNull();
    expect(usage.detached).toEqual([row.id]);
    const entries = await admin.activityLog.findMany({
      where: { entityType: 'SETTING', entityId: row.id, action: 'SETTINGS_CHANGE' },
    });
    expect(entries).toHaveLength(1);
  });

  it('refuses a Member to delete (403) and keeps the row', async () => {
    const row = await seedTechnology('member-delete');
    await request(app.getHttpServer())
      .delete(`${BASE}/${row.id}`)
      .set('Authorization', as('MEMBER'))
      .expect(403);
    await expect(admin.technology.findUnique({ where: { id: row.id } })).resolves.not.toBeNull();
  });

  it('sorts the list by usage, most used first', async () => {
    const low = await seedTechnology('low');
    const high = await seedTechnology('high');
    usage.setLiveProjects(low.id, 1);
    usage.setLiveProjects(high.id, 5);
    const res = await request(app.getHttpServer())
      .get(`${BASE}?q=E2E&sort=usageCount:desc`)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(res.body.items.map((t: { id: string }) => t.id)).toEqual([high.id, low.id]);
  });
});
