import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SettingsModule } from '../../src/modules/settings/settings.module';
import { COMPANY_LOGO } from '../../src/modules/settings/application/ports/company-logo.port';
import type { CurrentUser } from '../../src/shared/application/current-user';
import type { UserRole } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { FakeAuthenticator } from '../support/fakes/fake-authenticator';
import { FakeAuthorization } from '../support/fakes/fake-authorization';
import { createTestApp } from '../support/test-app';
import { FakeCompanyLogo } from './fakes/fake-company-logo';

const BASE = '/api/v1/settings/company';
const admin = createTestPrisma(assertLocalDatabaseUrl(process.env.DATABASE_URL));

/** Matrix stand-in for the `settings` grant (PRD §4.3): Owner and Admin update, everyone reads. */
const settingsPolicy = new FakeAuthorization({
  policy: (user, action, resource) =>
    action === 'update' && resource === 'settings' && ['OWNER', 'ADMIN'].includes(user.role),
});

const body = {
  name: 'WeDevs Studio',
  legalName: 'WeDevs Studio, C.A.',
  taxId: 'J-12345678-9',
  address: 'Calle Demo 1, Caracas',
};

describe('company settings (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let logo: FakeCompanyLogo;
  const tokens: Partial<Record<UserRole, string>> = {};

  beforeAll(async () => {
    authenticator = new FakeAuthenticator();
    logo = new FakeCompanyLogo();
    app = await createTestApp({
      modules: [SettingsModule],
      authenticator,
      authorization: settingsPolicy,
      overrides: [{ token: COMPANY_LOGO, useValue: logo }],
    });
  });

  afterAll(async () => {
    await app.close();
    await admin.$disconnect();
  });

  beforeEach(async () => {
    await truncateBusinessTables(admin);
    await admin.setting.deleteMany({ where: { key: 'company' } });
    logo.markReady('fil_logo');
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
  });

  const as = (role: UserRole) => `Bearer ${tokens[role]}`;

  it('refuses an unauthenticated read with UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer()).get(BASE).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('lets a Viewer read the empty default profile (200)', async () => {
    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', as('VIEWER'))
      .expect(200);
    expect(res.body).toEqual({
      name: '',
      legalName: null,
      taxId: null,
      address: null,
      logoFileId: null,
    });
  });

  it('refuses a Member update with FORBIDDEN and writes nothing', async () => {
    const res = await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('MEMBER'))
      .send(body)
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await expect(admin.setting.findUnique({ where: { key: 'company' } })).resolves.toBeNull();
    await expect(admin.activityLog.count({ where: { action: 'SETTINGS_CHANGE' } })).resolves.toBe(
      0,
    );
  });

  it('lets an Owner update (200), then logs exactly one SETTINGS_CHANGE', async () => {
    const res = await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('OWNER'))
      .send({ ...body, logoFileId: 'fil_logo' })
      .expect(200);
    expect(res.body).toEqual({ ...body, logoFileId: 'fil_logo' });

    const logs = await admin.activityLog.findMany({ where: { action: 'SETTINGS_CHANGE' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorType: 'USER',
      entityType: 'SETTING',
      entityId: 'company',
      entityLabel: 'WeDevs Studio',
      changes: { name: ['', 'WeDevs Studio'] },
    });

    const read = await request(app.getHttpServer())
      .get(BASE)
      .set('Authorization', as('MEMBER'))
      .expect(200);
    expect(read.body).toMatchObject({ name: 'WeDevs Studio', logoFileId: 'fil_logo' });
  });

  it('lets an Admin update too, and logs nothing for a repeated identical save', async () => {
    await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body)
      .expect(200);
    await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('ADMIN'))
      .send(body)
      .expect(200);
    await expect(admin.activityLog.count({ where: { action: 'SETTINGS_CHANGE' } })).resolves.toBe(
      1,
    );
  });

  it('answers 422 VALIDATION for a logo that is not a ready file and writes nothing', async () => {
    const res = await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('OWNER'))
      .send({ ...body, logoFileId: 'fil_missing' })
      .expect(422);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { logoFileId: ['validation.id.invalid'] },
    });
    await expect(admin.setting.findUnique({ where: { key: 'company' } })).resolves.toBeNull();
    await expect(admin.activityLog.count({ where: { action: 'SETTINGS_CHANGE' } })).resolves.toBe(
      0,
    );
  });

  it('answers 422 VALIDATION for a blank or missing name', async () => {
    const blank = await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('OWNER'))
      .send({ ...body, name: '   ' })
      .expect(422);
    expect(blank.body.error.code).toBe('VALIDATION');
    expect(blank.body.error.fieldErrors).toEqual({ name: ['validation.required'] });

    const missing = await request(app.getHttpServer())
      .patch(BASE)
      .set('Authorization', as('OWNER'))
      .send({ legalName: 'No name' })
      .expect(422);
    expect(missing.body.error.code).toBe('VALIDATION');
  });
});
