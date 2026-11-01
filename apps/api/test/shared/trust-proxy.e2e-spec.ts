import { Controller, Get, Module, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.setup';
import { parseEnv } from '../../src/config/env.schema';
import { REQUEST_CONTEXT } from '../../src/shared/application/ports/tokens';
import { CorrelationIdMiddleware } from '../../src/shared/interface/correlation-id.middleware';
import { HttpErrorFilter } from '../../src/shared/interface/http-error.filter';
import { APP_LOGGER } from '../../src/shared/interface/logger';
import { RequestContextMiddleware } from '../../src/shared/interface/request-context.middleware';
import { AppZodValidationPipe } from '../../src/shared/interface/zod-validation';
import { TEST_ENV } from '../support/test-env';
import { TEST_APP_URL } from '../support/test-app';

@Controller('whoami')
class WhoAmIController {
  @Get()
  get(@Req() req: { ip?: string }) {
    return { ip: req.ip };
  }
}

@Module({
  controllers: [WhoAmIController],
  providers: [
    { provide: APP_LOGGER, useValue: { error() {}, warn() {}, info() {} } },
    { provide: REQUEST_CONTEXT, useValue: { run: (_ctx: unknown, fn: () => void) => fn() } },
    HttpErrorFilter,
    AppZodValidationPipe,
    CorrelationIdMiddleware,
    RequestContextMiddleware,
  ],
})
class WhoAmIModule {}

async function boot(hops?: string): Promise<NestExpressApplication> {
  const config = parseEnv({
    NODE_ENV: 'test',
    APP_URL: TEST_APP_URL,
    DATABASE_URL: 'postgresql://postgres:dev@localhost:5432/core',
    ...TEST_ENV,
    ...(hops === undefined ? {} : { TRUST_PROXY_HOPS: hops }),
  });
  const moduleRef = await Test.createTestingModule({ imports: [WhoAmIModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();
  return app;
}

describe('TRUST_PROXY_HOPS (DT-143)', () => {
  let app: NestExpressApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const forwarded = '203.0.113.9';

  it('ignores X-Forwarded-For with 0 hops (the default)', async () => {
    app = await boot();
    const res = await request(app.getHttpServer())
      .get('/api/v1/whoami')
      .set('X-Forwarded-For', forwarded)
      .expect(200);
    expect(res.body.ip).not.toContain(forwarded);
  });

  it('follows X-Forwarded-For with 1 hop, taking the address the proxy appended', async () => {
    app = await boot('1');
    const res = await request(app.getHttpServer())
      .get('/api/v1/whoami')
      .set('X-Forwarded-For', `198.51.100.7, ${forwarded}`)
      .expect(200);
    expect(res.body.ip).toBe(forwarded);
  });
});
