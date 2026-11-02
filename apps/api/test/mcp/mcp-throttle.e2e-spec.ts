import 'reflect-metadata';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../src/config/env.schema';
import { createTestPrisma } from '../support/db';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';
import { TEST_APP_URL } from '../support/test-app';
import { TEST_ENV } from '../support/test-env';
import { seedWorld, startMcpApp, V1, type McpWorld } from './harness';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const LIMIT = 3;

describe('POST /mcp throttler (e2e): A8', () => {
  const prisma = createTestPrisma();
  let base: Awaited<ReturnType<typeof startMcpApp>>;
  let world: McpWorld;

  beforeAll(async () => {
    const config = parseEnv({
      NODE_ENV: 'test',
      APP_URL: TEST_APP_URL,
      DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
      ...TEST_ENV,
      THROTTLE_TTL: '60',
      THROTTLE_LIMIT: String(LIMIT),
    });
    base = await startMcpApp(config);
    world = await seedWorld(base, prisma);
  });
  afterAll(async () => {
    await base.app.close();
    await prisma.$disconnect();
  });

  const ping = (secret: string) =>
    request(base.app.getHttpServer())
      .post(`${V1}/mcp`)
      .set('Authorization', `Bearer ${secret}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'ping' });

  it(`answers 429 RATE_LIMITED after ${LIMIT} calls of one token, while another token and other routes are unaffected`, async () => {
    for (let n = 1; n <= LIMIT; n += 1) expect((await ping(world.secrets.OWNER)).status).toBe(200);
    const limited = await ping(world.secrets.OWNER);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');

    expect((await ping(world.secrets.ADMIN)).status).toBe(200);
    await request(base.app.getHttpServer()).get(`${V1}/health`).expect(200);
    await request(base.app.getHttpServer())
      .get(`${V1}/me/api-tokens`)
      .set('Authorization', `Bearer ${world.sessions.OWNER}`)
      .expect(200);
  });
});
