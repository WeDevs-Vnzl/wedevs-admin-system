import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_STATUS } from '../src/shared/interface/http-error.filter';
import type { CurrentUser } from '../src/shared/application/current-user';
import { AUTHENTICATOR, AUTHORIZATION } from '../src/shared/application/ports/tokens';
import type { FakeAuthenticator } from './support/fakes/fake-authenticator';
import type { FakeAuthorization } from './support/fakes/fake-authorization';
import { createTestApp } from './support/test-app';

const REQUEST_ID = 'req-e2e-12345';

describe('error envelope (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  for (const [code, status] of Object.entries(ERROR_STATUS)) {
    if (code === 'INTERNAL') continue;
    it(`${code} -> ${status} envelope with nulls, correlationId and X-Request-Id echo`, async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/probe/error/${code}`)
        .set('X-Request-Id', REQUEST_ID)
        .expect(status);
      expect(res.headers['x-request-id']).toBe(REQUEST_ID);
      expect(res.body.error).toMatchObject({
        code,
        message: `common.errors.${code}`,
        correlationId: REQUEST_ID,
      });
      expect(res.body.error).toHaveProperty('fieldErrors');
      expect(res.body.error).toHaveProperty('entity');
      if (code === 'VALIDATION') {
        expect(res.body.error.fieldErrors).toEqual({ name: ['validation.required'] });
      } else if (code === 'CONFLICT') {
        expect(res.body.error.entity).toEqual({
          type: 'Client',
          id: 'cl_1',
          code: null,
          label: 'Acme',
        });
      } else {
        expect(res.body.error.fieldErrors).toBeNull();
        expect(res.body.error.entity).toBeNull();
      }
    });
  }

  it('unknown route -> 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.correlationId).not.toBe('unknown');
  });

  it('malformed JSON -> 422 with the sent correlation id', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/body')
      .set('X-Request-Id', REQUEST_ID)
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.correlationId).toBe(REQUEST_ID);
  });

  it('Zod body is validated into fieldErrors keys', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/probe/body')
      .send({ name: '', amount: 1 })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fieldErrors.name).toEqual(['validation.required']);
    await request(app.getHttpServer())
      .post('/api/v1/probe/body')
      .send({ name: 'ok', amount: 3 })
      .expect(201);
  });

  it('raw Error -> 500 INTERNAL without leaking details', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/probe/raw-error').expect(500);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.fieldErrors).toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|secret internal/);
  });
});

describe('auth guard (e2e)', () => {
  let app: NestExpressApplication;
  let authenticator: FakeAuthenticator;
  let authorization: FakeAuthorization;
  const USER: CurrentUser = {
    userId: 'usr_e2e',
    clerkId: 'user_clerk_e2e',
    role: 'MEMBER',
    email: 'member@example.test',
    name: 'Member',
  };
  beforeAll(async () => {
    app = await createTestApp();
    authenticator = app.get(AUTHENTICATOR);
    authorization = app.get(AUTHORIZATION);
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1/probe/auth/${path}`);

  it('no token -> 401 UNAUTHENTICATED envelope', async () => {
    const res = await get('authenticated').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('unknown token -> 401', async () => {
    await get('authenticated').set('Authorization', 'Bearer nope').expect(401);
  });

  it('valid token reaches the handler with @CurrentUser()', async () => {
    const res = await get('authenticated')
      .set('Authorization', `Bearer ${authenticator.issue(USER)}`)
      .expect(200);
    expect(res.body).toEqual({ userId: 'usr_e2e' });
  });

  it('@RequiresGrant: denied -> 403, allowed -> 200', async () => {
    const bearer = `Bearer ${authenticator.issue(USER)}`;
    authorization.setPolicy(() => false);
    const denied = await get('grant').set('Authorization', bearer).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    authorization.setPolicy(() => true);
    await get('grant').set('Authorization', bearer).expect(200);
  });

  it('undeclared and double-declared routes are denied (403), fail-closed', async () => {
    const bearer = `Bearer ${authenticator.issue(USER)}`;
    await get('undeclared').set('Authorization', bearer).expect(403);
    await get('double').set('Authorization', bearer).expect(403);
  });
});
