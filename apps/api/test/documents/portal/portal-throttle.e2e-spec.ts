import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeAuthenticator } from '../../support/fakes/fake-authenticator';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryFileStorage } from '../../support/fakes/in-memory-file-storage';
import { createPortalApp } from './app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const LIMIT = 3;
const PORTAL = '/api/v1/portal';

describe('portal throttler (e2e): DT-88, C22', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createPortalApp({
      authenticator: new FakeAuthenticator(),
      storage: new InMemoryFileStorage(),
      clock: new FixedClock('2026-10-30T12:00:00.000Z'),
      throttleLimit: LIMIT,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it(`answers RATE_LIMITED with 429 and the C22 headers after ${LIMIT} requests, per portal route`, async () => {
    const token = 'Z'.repeat(43);
    for (let n = 1; n <= LIMIT; n += 1) {
      const res = await http().get(`${PORTAL}/${token}`);
      expect(res.status).toBe(404);
    }
    const limited = await http().get(`${PORTAL}/${token}`);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'common.errors.RATE_LIMITED',
    });
    expect(limited.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(limited.headers['referrer-policy']).toBe('no-referrer');
    expect(limited.headers['cache-control']).toBe('private, no-store');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // The bucket is per route and visitor IP (the throttler keys on the handler): another portal route has its
    // own count, and it is limited the same way.
    const post = () =>
      http().post(`${PORTAL}/${token}/documents/doc_a/unlock`).send({ key: 'ANY-KEY-LONG-ENOUGH' });
    for (let n = 1; n <= LIMIT; n += 1) expect((await post()).status).toBe(404);
    const unlock = await post();
    expect(unlock.status).toBe(429);
    expect(unlock.body.error.code).toBe('RATE_LIMITED');
    expect(unlock.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('leaves the other routes alone: no throttling outside the portal controller', async () => {
    for (let n = 1; n <= LIMIT + 3; n += 1) {
      const res = await http().get('/api/v1/share-links');
      expect(res.status).toBe(401);
      expect(res.headers['x-robots-tag']).toBeUndefined();
    }
  });
});
