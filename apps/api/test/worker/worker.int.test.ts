import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../src/config/config.module';
import type { AppConfig } from '../../src/config/env.schema';
import { startWorker } from '../../src/worker.module';
import { startRedis, type RedisContainer } from '../support/redis-container';
import { applyTestEnv } from '../support/test-env';
import { createTestApp } from '../support/test-app';

describe('worker bootstrap (int)', () => {
  let redis: RedisContainer;
  beforeAll(async () => {
    redis = await startRedis();
  }, 120_000);
  afterAll(async () => {
    await redis.stop();
  });

  it('boots the worker context against Redis and closes it', async () => {
    applyTestEnv();
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3001',
      REDIS_URL: redis.url,
    });
    const context = await startWorker();
    expect(context.get<AppConfig>(APP_CONFIG).REDIS_URL).toBe(redis.url);
    await context.close();
  });

  it('refuses to boot without REDIS_URL, naming only the variable', async () => {
    delete process.env.REDIS_URL;
    await expect(startWorker()).rejects.toThrow('REDIS_URL is required to start the worker');
  });

  it('boots the API with no REDIS_URL', async () => {
    delete process.env.REDIS_URL;
    const app = await createTestApp();
    expect(app.get<AppConfig>(APP_CONFIG).REDIS_URL).toBeUndefined();
    await app.close();
  });
});
