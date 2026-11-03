import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../src/config/config.module';
import type { AppConfig } from '../../src/config/env.schema';
import { startWorker } from '../../src/worker.module';
import { startRedis, type RedisContainer } from '../support/redis-container';
import { applyTestEnv } from '../support/test-env';
import { createTestApp } from '../support/test-app';

const CLERK_NAMES = [
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_JWT_KEY',
  'CLERK_WEBHOOK_SECRET',
] as const;

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

  it('boots with no Clerk variable', async () => {
    for (const name of CLERK_NAMES) Reflect.deleteProperty(process.env, name);
    process.env.REDIS_URL = redis.url;
    const context = await startWorker();
    await context.close();
  });

  it('refuses to boot without REDIS_URL, naming only the variable', async () => {
    delete process.env.REDIS_URL;
    await expect(startWorker()).rejects.toThrow(
      'Invalid or missing environment variables: REDIS_URL',
    );
  });

  it.each(['CLOUDINARY_CLOUD_NAME', 'SHARE_UNLOCK_SECRET'])(
    'refuses to boot without %s, naming it',
    async (name) => {
      process.env.REDIS_URL = redis.url;
      const saved = process.env[name];
      Reflect.deleteProperty(process.env, name);
      try {
        await expect(startWorker()).rejects.toThrow(
          `Invalid or missing environment variables: ${name}`,
        );
      } finally {
        process.env[name] = saved;
      }
    },
  );

  it('boots the API with no REDIS_URL', async () => {
    delete process.env.REDIS_URL;
    applyTestEnv();
    const app = await createTestApp();
    expect(app.get<AppConfig>(APP_CONFIG).REDIS_URL).toBeUndefined();
    await app.close();
  });
});
