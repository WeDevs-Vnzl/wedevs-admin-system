import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiTokenRoutesModule } from '../../../src/modules/mcp/api-token-routes.module';
import { AUTHENTICATOR } from '../../../src/shared/application/ports/tokens';
import type { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { createTestApp } from '../../support/test-app';

const prisma = createTestPrisma();
let app: NestExpressApplication;
let clerk: FakeAuthenticator;

const http = () => request(app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedUser(tag: string, role: 'OWNER' | 'MEMBER' = 'OWNER') {
  const user = await prisma.user.create({
    data: { clerkId: `clerk_${tag}`, email: `${tag}@example.com`, name: `User ${tag}`, role },
  });
  const jwt = clerk.issue({
    userId: user.id,
    clerkId: user.clerkId,
    role,
    email: user.email,
    name: user.name,
  });
  return { user, jwt };
}

beforeAll(async () => {
  await truncateBusinessTables(prisma);
  app = await createTestApp({ modules: [ApiTokenRoutesModule] });
  clerk = app.get<FakeAuthenticator>(AUTHENTICATOR);
}, 60_000);
beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST|GET /me/api-tokens and POST /me/api-tokens/{id}/revoke', () => {
  it('issues a token (secret once), lists it without the secret and revokes it', async () => {
    const { jwt } = await seedUser('owner');
    const created = await http()
      .post('/api/v1/me/api-tokens')
      .set(bearer(jwt))
      .send({ name: 'Claude desktop', expiresInDays: 30 });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^wdc_pat_[A-Za-z0-9_-]{43}$/);
    expect(created.body.prefix).toBe(created.body.secret.slice(0, 12));
    expect(created.body.revokedAt).toBeNull();

    const listed = await http().get('/api/v1/me/api-tokens').set(bearer(jwt));
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).not.toHaveProperty('secret');
    expect(listed.body.items[0]).not.toHaveProperty('tokenHash');

    const revoked = await http()
      .post(`/api/v1/me/api-tokens/${created.body.id}/revoke`)
      .set(bearer(jwt));
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedAt).not.toBeNull();
    expect(await prisma.activityLog.count({ where: { entityType: 'API_TOKEN' } })).toBe(2);
  });

  it('lists and revokes own tokens only: another user token answers 404', async () => {
    const a = await seedUser('a');
    const b = await seedUser('b', 'MEMBER');
    const created = await http()
      .post('/api/v1/me/api-tokens')
      .set(bearer(a.jwt))
      .send({ name: 'Mine' });
    expect((await http().get('/api/v1/me/api-tokens').set(bearer(b.jwt))).body.items).toEqual([]);
    const res = await http()
      .post(`/api/v1/me/api-tokens/${created.body.id}/revoke`)
      .set(bearer(b.jwt));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 401 without a session, 422 for an invalid body and 409 past 10 active tokens', async () => {
    expect((await http().get('/api/v1/me/api-tokens')).status).toBe(401);
    const { jwt } = await seedUser('owner');
    const invalid = await http()
      .post('/api/v1/me/api-tokens')
      .set(bearer(jwt))
      .send({ name: ' ', expiresInDays: 400 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('VALIDATION');
    for (let i = 0; i < 10; i++) {
      const ok = await http()
        .post('/api/v1/me/api-tokens')
        .set(bearer(jwt))
        .send({ name: `t${i}` });
      expect(ok.status).toBe(201);
    }
    const eleventh = await http()
      .post('/api/v1/me/api-tokens')
      .set(bearer(jwt))
      .send({ name: 'one too many' });
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error.code).toBe('CONFLICT');
  });

  it('a personal access token cannot reach the token routes or any other route (DT-190)', async () => {
    const { jwt } = await seedUser('owner');
    const created = await http().post('/api/v1/me/api-tokens').set(bearer(jwt)).send({ name: 'x' });
    const pat = created.body.secret as string;
    for (const path of ['/api/v1/me/api-tokens', '/api/v1/me']) {
      const res = await http().get(path).set(bearer(pat));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });
});
