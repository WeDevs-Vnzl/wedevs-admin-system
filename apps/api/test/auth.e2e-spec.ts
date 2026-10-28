import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityModule } from '../src/modules/identity/identity.module';
import { IDENTITY_PROVIDER } from '../src/modules/identity/application/ports/identity-provider.port';
import { FILE_STORAGE } from '../src/modules/platform/application/ports/file-storage.port';
import type { UserRole } from '../src/shared/domain/enums';
import { FakeIdentityProvider } from './identity/fakes/fake-identity-provider';
import { createTestPrisma, truncateBusinessTables } from './support/db';
import { InMemoryFileStorage } from './support/fakes/in-memory-file-storage';
import { createTestApp } from './support/test-app';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const prisma = createTestPrisma();
const identity = new FakeIdentityProvider();
let app: NestExpressApplication;

const http = () => request(app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedUser(role: UserRole) {
  const tag = role.toLowerCase();
  const user = await prisma.user.create({
    data: { clerkId: `clerk_${tag}`, email: `${tag}@example.test`, name: `User ${tag}`, role },
  });
  return identity.issue(user.clerkId);
}

beforeAll(async () => {
  // Real AuthenticateRequest + MatrixAuthorization (IdentityModule); only Clerk and Cloudinary are fakes.
  app = await createTestApp({
    modules: [IdentityModule],
    overrides: [
      { token: IDENTITY_PROVIDER, useValue: identity },
      { token: FILE_STORAGE, useValue: new InMemoryFileStorage() },
    ],
  });
}, 60_000);
beforeEach(async () => {
  await truncateBusinessTables(prisma);
});
afterAll(async () => {
  await app.close();
  await truncateBusinessTables(prisma);
  await prisma.$disconnect();
});

describe('every non-public route requires a bearer token', () => {
  it('answers 401 UNAUTHENTICATED without a token on every secured operation of the inventory', async () => {
    const doc = await http().get('/api/openapi.json').expect(200);
    const paths = doc.body.paths as Record<string, Record<string, { security?: unknown[] }>>;
    const secured = Object.entries(paths)
      .filter(([path]) => !path.startsWith('/api/v1/probe/')) // test-only fixture routes
      .flatMap(([path, methods]) =>
        Object.entries(methods)
          .filter(([, op]) => op.security === undefined || op.security.length > 0)
          .map(([method]) => ({ method: method as Method, path: path.replace(/\{[^}]+\}/g, 'x') })),
      );
    // Public routes carry `security: []`; everything else is secured (health and the webhook excepted).
    expect(secured.length).toBeGreaterThan(15);

    for (const { method, path } of secured) {
      const res = await http()[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body.error.code, `${method.toUpperCase()} ${path}`).toBe('UNAUTHENTICATED');
    }
  });

  it('keeps health public', async () => {
    await http().get('/api/v1/health').expect(200);
  });
});

describe('HU-01 CA1: an uninvited user is refused', () => {
  it('a valid session whose clerkId has no local User is 401 on /me and nothing is provisioned', async () => {
    const res = await http()
      .get('/api/v1/me')
      .set(bearer(identity.issue('clerk_uninvited')))
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(await prisma.user.count()).toBe(0);
  });

  it('an invited user is let in with the DB role', async () => {
    const token = await seedUser('MEMBER');
    const res = await http().get('/api/v1/me').set(bearer(token)).expect(200);
    expect(res.body).toMatchObject({ role: 'MEMBER' });
  });
});

describe('HU-02 CA2: a Member cannot create financial data', () => {
  it('Member gets 403 FORBIDDEN on a use case declaring invoice:create and nothing is written', async () => {
    const token = await seedUser('MEMBER');
    const before = await prisma.activityLog.count();
    const res = await http().post('/api/v1/probe/invoices').set(bearer(token)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.activityLog.count()).toBe(before);
  });

  it('Owner passes and the activity entry is written', async () => {
    const token = await seedUser('OWNER');
    const before = await prisma.activityLog.count();
    await http().post('/api/v1/probe/invoices').set(bearer(token)).expect(201);
    expect(await prisma.activityLog.count()).toBe(before + 1);
  });
});
