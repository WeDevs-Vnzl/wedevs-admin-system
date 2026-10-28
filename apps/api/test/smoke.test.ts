import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/config.module';
import { TEST_ENV } from './support/test-env';

describe('smoke', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('compiles the Nest app module with decorator metadata and validated config', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('APP_URL', 'http://localhost:3001');
    vi.stubEnv('DATABASE_URL', 'postgresql://postgres:dev@localhost:5432/core');
    for (const [name, value] of Object.entries(TEST_ENV)) vi.stubEnv(name, value);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const config = moduleRef.get<{ PORT: number }>(APP_CONFIG);
    expect(config.PORT).toBe(3000);
    await moduleRef.close();
  });
});
