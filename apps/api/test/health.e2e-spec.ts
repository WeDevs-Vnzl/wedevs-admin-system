import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/modules/platform/interface/http/dto/health.dto';
import { createTestApp, TEST_APP_URL } from './support/test-app';

describe('GET /api/v1/health (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers 200 with the DTO body and no auth', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(healthResponseSchema.parse(res.body)).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes APP_URL in CORS and no other origin', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', TEST_APP_URL)
      .expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe(TEST_APP_URL);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const other = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com')
      .expect(200);
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves the OpenAPI document outside production', async () => {
    const res = await request(app.getHttpServer()).get('/api/openapi.json').expect(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
    expect(res.body.paths['/api/v1/health']).toBeDefined();
    expect(res.body.components.schemas.ErrorResponse).toBeDefined();
  });
});
