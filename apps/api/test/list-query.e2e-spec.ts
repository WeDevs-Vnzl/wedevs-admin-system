import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './support/test-app';

describe('list query (e2e)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const list = (qs: string) => request(app.getHttpServer()).get(`/api/v1/probe/list${qs}`);

  it('applies defaults', async () => {
    const res = await list('').expect(200);
    expect(res.body).toMatchObject({
      page: 1,
      pageSize: 25,
      archived: 'exclude',
      sort: { field: 'createdAt', direction: 'desc' },
    });
  });

  it('pageSize=30 -> 422 fieldErrors.pageSize', async () => {
    const res = await list('?pageSize=30').expect(422);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(res.body.error.fieldErrors.pageSize).toBeDefined();
  });

  it('non-whitelisted sort -> 422 validation.sort.invalid', async () => {
    const res = await list('?sort=password:asc').expect(422);
    expect(res.body.error.fieldErrors.sort).toEqual(['validation.sort.invalid']);
  });

  it('accepts a whitelisted sort', async () => {
    const res = await list('?sort=name:asc').expect(200);
    expect(res.body.sort).toEqual({ field: 'name', direction: 'asc' });
  });

  it('trims q and parses archived=only', async () => {
    const res = await list('?q=%20%20acme%20&archived=only').expect(200);
    expect(res.body.q).toBe('acme');
    expect(res.body.archived).toBe('only');
  });
});
