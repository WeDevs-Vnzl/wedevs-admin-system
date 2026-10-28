import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DocumentTypesModule } from '../../../src/modules/settings/document-types.module';
import { DOCUMENT_TYPE_USAGE } from '../../../src/modules/settings/application/ports/document-type-usage.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FakeAuthorization } from '../../support/fakes/fake-authorization';
import { createTestApp } from '../../support/test-app';
import { FakeDocumentTypeUsage } from './fakes/fake-document-type-usage';
import { restoreCatalog, snapshotCatalog, type CatalogSnapshot } from './catalog-snapshot';

const CATEGORIES = '/api/v1/document-categories';
const TYPES = '/api/v1/document-types';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** Matrix stand-in for the `settings` grants (PRD §4.3): Owner and Admin write, everyone reads. */
const settingsPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    resource === 'settings' &&
    ['create', 'update', 'delete'].includes(action) &&
    ['OWNER', 'ADMIN'].includes(user.role),
});

/** The host is shared with the other packages' suites: hooks and tests get room beyond the 5 s / 10 s defaults. */
const SLOW_MS = 60_000;

describe('document categories and types (e2e)', { timeout: SLOW_MS }, () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let usage: FakeDocumentTypeUsage;
  let seeded: CatalogSnapshot;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    seeded = await snapshotCatalog(admin);
    authenticator = new FakeAuthenticator();
    usage = new FakeDocumentTypeUsage();
    app = await createTestApp({
      modules: [DocumentTypesModule],
      authenticator,
      authorization: settingsPolicy,
      overrides: [{ token: DOCUMENT_TYPE_USAGE, useValue: usage }],
    });
  }, SLOW_MS);

  afterAll(async () => {
    await restoreCatalog(admin, seeded);
    await app.close();
    await admin.$disconnect();
  }, SLOW_MS);

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    await admin.documentType.deleteMany();
    await admin.documentCategory.deleteMany();
    await admin.documentCategory.createMany({
      data: [
        { id: 'dcat_e2e_legal', name: 'Legal', nameEn: 'Legal', color: '#6d28d9', order: 0 },
        { id: 'dcat_e2e_tecnico', name: 'Técnico', nameEn: null, color: null, order: 1 },
        { id: 'dcat_e2e_financiero', name: 'Financiero', nameEn: null, color: null, order: 2 },
      ],
    });
    await admin.documentType.createMany({
      data: [
        {
          id: 'dtyp_e2e_contrato',
          categoryId: 'dcat_e2e_legal',
          name: 'Contrato de servicios',
          nameEn: 'Service agreement',
          requiresSignature: true,
          hasExpiration: true,
          defaultFormat: 'ARCHIVO',
          active: true,
        },
        {
          id: 'dtyp_e2e_adenda',
          categoryId: 'dcat_e2e_legal',
          name: 'Adenda',
          nameEn: null,
          requiresSignature: true,
          hasExpiration: false,
          defaultFormat: 'ARCHIVO',
          active: true,
        },
      ],
    });
    usage.reset();
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const) {
      const row = await admin.user.create({
        data: {
          clerkId: `user_e2e_dt_${role.toLowerCase()}`,
          email: `dt-${role.toLowerCase()}@example.test`,
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
  }, SLOW_MS);

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;
  const server = () => app.getHttpServer();

  describe('reads (any signed-in role)', () => {
    it('refuses an unauthenticated read with UNAUTHENTICATED', async () => {
      const res = await request(server()).get(CATEGORIES).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('lets a Viewer read the categories in order, each with its types', async () => {
      const res = await request(server())
        .get(CATEGORIES)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(res.body.map((row: { name: string }) => row.name)).toEqual([
        'Legal',
        'Técnico',
        'Financiero',
      ]);
      expect(res.body[0].types.map((t: { name: string }) => t.name)).toEqual([
        'Adenda',
        'Contrato de servicios',
      ]);
      expect(res.body[0].types[0]).toEqual({
        id: 'dtyp_e2e_adenda',
        name: 'Adenda',
        nameEn: null,
        defaultFormat: 'ARCHIVO',
        requiresSignature: true,
        hasExpiration: false,
        active: true,
        documentCount: 0,
      });
    });

    it('lets a Member list the types as a paged envelope, filtered by category', async () => {
      const res = await request(server())
        .get(`${TYPES}?categoryId=dcat_e2e_legal&pageSize=25`)
        .set('Authorization', as('MEMBER'))
        .expect(200);
      expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 25, pageCount: 1 });
      expect(res.body.items.map((row: { id: string }) => row.id)).toEqual([
        'dtyp_e2e_adenda',
        'dtyp_e2e_contrato',
      ]);
      expect(res.body.items[0].category).toEqual({
        id: 'dcat_e2e_legal',
        name: 'Legal',
        nameEn: 'Legal',
        color: '#6d28d9',
      });
    });

    it('answers 422 VALIDATION for a sort outside the whitelist', async () => {
      const res = await request(server())
        .get(`${TYPES}?sort=id:asc`)
        .set('Authorization', as('VIEWER'))
        .expect(422);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { sort: ['validation.sort.invalid'] },
      });
    });

    it('answers NOT_FOUND for an unknown type', async () => {
      const res = await request(server())
        .get(`${TYPES}/dtyp_nope`)
        .set('Authorization', as('VIEWER'))
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('category writes', () => {
    it('refuses a Member create with FORBIDDEN and writes nothing', async () => {
      const res = await request(server())
        .post(CATEGORIES)
        .set('Authorization', as('MEMBER'))
        .send({ name: 'Operativo' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await expect(admin.documentCategory.count()).resolves.toBe(3);
      await expect(admin.activityLog.count({ where: { action: 'SETTINGS_CHANGE' } })).resolves.toBe(
        0,
      );
    });

    it('lets an Owner create a category at the end and logs one SETTINGS_CHANGE', async () => {
      const res = await request(server())
        .post(CATEGORIES)
        .set('Authorization', as('OWNER'))
        .send({ name: 'Operativo', nameEn: 'Operations', color: '#b45309' })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Operativo',
        nameEn: 'Operations',
        color: '#b45309',
        order: 3,
        types: [],
      });
      const logs = await admin.activityLog.findMany({ where: { action: 'SETTINGS_CHANGE' } });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actorType: 'USER',
        entityType: 'SETTING',
        entityId: res.body.id,
        changes: { documentCategory: [null, 'Operativo'] },
      });
    });

    it('answers 409 CONFLICT for a name taken by another category, case-insensitively', async () => {
      const res = await request(server())
        .post(CATEGORIES)
        .set('Authorization', as('ADMIN'))
        .send({ name: 'LEGAL' })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        fieldErrors: { name: ['catalogs.documentTypes.errors.categoryNameTaken'] },
      });
    });

    it('answers 422 VALIDATION for a blank name and a malformed colour', async () => {
      const blank = await request(server())
        .post(CATEGORIES)
        .set('Authorization', as('OWNER'))
        .send({ name: '   ' })
        .expect(422);
      expect(blank.body.error.fieldErrors).toEqual({ name: ['validation.required'] });

      const colour = await request(server())
        .post(CATEGORIES)
        .set('Authorization', as('OWNER'))
        .send({ name: 'Nueva', color: 'blue' })
        .expect(422);
      expect(colour.body.error.fieldErrors).toEqual({ color: ['validation.invalidFormat'] });
    });

    it('answers 422 VALIDATION for a reorder with a missing id, all or nothing', async () => {
      const res = await request(server())
        .post(`${CATEGORIES}/reorder`)
        .set('Authorization', as('OWNER'))
        .send({ orderedIds: ['dcat_e2e_tecnico', 'dcat_e2e_legal'] })
        .expect(422);
      expect(res.body.error.fieldErrors).toEqual({
        orderedIds: ['catalogs.documentTypes.errors.reorderMismatch'],
      });
      const rows = await admin.documentCategory.findMany({ orderBy: { order: 'asc' } });
      expect(rows.map((row) => row.id)).toEqual([
        'dcat_e2e_legal',
        'dcat_e2e_tecnico',
        'dcat_e2e_financiero',
      ]);
    });

    it('lets an Admin reorder with the full id set and renumbers from 0', async () => {
      const res = await request(server())
        .post(`${CATEGORIES}/reorder`)
        .set('Authorization', as('ADMIN'))
        .send({
          orderedIds: ['dcat_e2e_financiero', 'dcat_e2e_legal', 'dcat_e2e_tecnico'],
        })
        .expect(200);
      expect(res.body.map((row: { id: string }) => row.id)).toEqual([
        'dcat_e2e_financiero',
        'dcat_e2e_legal',
        'dcat_e2e_tecnico',
      ]);
      expect(res.body.map((row: { order: number }) => row.order)).toEqual([0, 1, 2]);
    });

    it('answers 409 INTEGRITY_LOCK when deleting a category that still has types', async () => {
      const res = await request(server())
        .delete(`${CATEGORIES}/dcat_e2e_legal`)
        .set('Authorization', as('OWNER'))
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'catalogs.documentTypes.errors.categoryHasTypes',
      });
      await expect(admin.documentCategory.count({ where: { id: 'dcat_e2e_legal' } })).resolves.toBe(
        1,
      );
    });

    it('deletes an empty category, renumbers the rest and returns its id', async () => {
      const res = await request(server())
        .delete(`${CATEGORIES}/dcat_e2e_financiero`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(res.body).toEqual({ id: 'dcat_e2e_financiero' });
      const rows = await admin.documentCategory.findMany({ orderBy: { order: 'asc' } });
      expect(rows.map((row) => row.order)).toEqual([0, 1]);
    });

    it('refuses a Viewer patch with FORBIDDEN', async () => {
      await request(server())
        .patch(`${CATEGORIES}/dcat_e2e_legal`)
        .set('Authorization', as('VIEWER'))
        .send({ name: 'Jurídico' })
        .expect(403);
    });
  });

  describe('type writes', () => {
    const body = {
      categoryId: 'dcat_e2e_legal',
      name: 'Poder notarial',
      requiresSignature: true,
      hasExpiration: true,
      defaultFormat: 'MARKDOWN',
    };

    it('lets an Admin create a type with its capabilities, available at once (HU-21 CA1)', async () => {
      const res = await request(server())
        .post(TYPES)
        .set('Authorization', as('ADMIN'))
        .send(body)
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Poder notarial',
        nameEn: null,
        requiresSignature: true,
        hasExpiration: true,
        defaultFormat: 'MARKDOWN',
        active: true,
        documentCount: 0,
        category: { id: 'dcat_e2e_legal' },
      });
      const list = await request(server())
        .get(`${TYPES}?active=true`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(list.body.items.map((row: { id: string }) => row.id)).toContain(res.body.id);
    });

    it('refuses a Member create with FORBIDDEN and writes nothing', async () => {
      await request(server()).post(TYPES).set('Authorization', as('MEMBER')).send(body).expect(403);
      await expect(admin.documentType.count()).resolves.toBe(2);
    });

    it('answers 409 CONFLICT for a name taken inside the same category', async () => {
      const res = await request(server())
        .post(TYPES)
        .set('Authorization', as('OWNER'))
        .send({ ...body, name: 'adenda' })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        fieldErrors: { name: ['catalogs.documentTypes.errors.typeNameTaken'] },
      });
    });

    it('answers 422 VALIDATION for an unknown category and an unknown format', async () => {
      const unknown = await request(server())
        .post(TYPES)
        .set('Authorization', as('OWNER'))
        .send({ ...body, categoryId: 'dcat_nope' })
        .expect(422);
      expect(unknown.body.error.fieldErrors).toEqual({
        categoryId: ['catalogs.documentTypes.errors.unknownCategory'],
      });
      const format = await request(server())
        .post(TYPES)
        .set('Authorization', as('OWNER'))
        .send({ ...body, defaultFormat: 'PDF' })
        .expect(422);
      expect(format.body.error.code).toBe('VALIDATION');
    });

    it('deactivates a type through its own route and filters it out of the active list', async () => {
      const res = await request(server())
        .post(`${TYPES}/dtyp_e2e_adenda/active`)
        .set('Authorization', as('ADMIN'))
        .send({ active: false })
        .expect(200);
      expect(res.body).toMatchObject({ id: 'dtyp_e2e_adenda', active: false });
      const list = await request(server())
        .get(`${TYPES}?active=true`)
        .set('Authorization', as('VIEWER'))
        .expect(200);
      expect(list.body.items.map((row: { id: string }) => row.id)).not.toContain('dtyp_e2e_adenda');
    });

    it('refuses a Member activation with FORBIDDEN', async () => {
      await request(server())
        .post(`${TYPES}/dtyp_e2e_adenda/active`)
        .set('Authorization', as('MEMBER'))
        .send({ active: false })
        .expect(403);
    });

    it('answers 422 VALIDATION for a non-boolean activation flag', async () => {
      const res = await request(server())
        .post(`${TYPES}/dtyp_e2e_adenda/active`)
        .set('Authorization', as('OWNER'))
        .send({ active: 'yes' })
        .expect(422);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('deletes an unused type, and answers NOT_FOUND for it afterwards', async () => {
      const res = await request(server())
        .delete(`${TYPES}/dtyp_e2e_adenda`)
        .set('Authorization', as('OWNER'))
        .expect(200);
      expect(res.body).toEqual({ id: 'dtyp_e2e_adenda' });
      await request(server())
        .get(`${TYPES}/dtyp_e2e_adenda`)
        .set('Authorization', as('VIEWER'))
        .expect(404);
    });

    it('answers 409 INTEGRITY_LOCK for a type that documents use, through the usage port', async () => {
      usage.setCount('dtyp_e2e_adenda', 1);
      const res = await request(server())
        .delete(`${TYPES}/dtyp_e2e_adenda`)
        .set('Authorization', as('OWNER'))
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'INTEGRITY_LOCK',
        message: 'catalogs.documentTypes.errors.typeInUse',
      });
      await expect(admin.documentType.count({ where: { id: 'dtyp_e2e_adenda' } })).resolves.toBe(1);
    });

    it('refuses a Viewer delete with FORBIDDEN', async () => {
      await request(server())
        .delete(`${TYPES}/dtyp_e2e_adenda`)
        .set('Authorization', as('VIEWER'))
        .expect(403);
    });
  });
});
