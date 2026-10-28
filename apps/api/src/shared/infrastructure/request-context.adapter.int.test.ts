import { Controller, Inject, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/support/test-app';
import { createTestPrisma, truncateBusinessTables } from '../../../test/support/db';
import type { ActivityLogPort } from '../application/ports/activity-log.port';
import { ACTIVITY_LOG, UNIT_OF_WORK } from '../application/ports/tokens';
import type { UnitOfWorkPort } from '../application/ports/unit-of-work.port';
import { Public } from '../interface/public.decorator';

@Controller('request-meta-probe')
class RequestMetaProbeController {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(ACTIVITY_LOG) private readonly activity: ActivityLogPort,
  ) {}

  @Public()
  @Post()
  async record(): Promise<{ ok: true }> {
    await this.uow.run(async () => {
      await this.activity.record({
        actor: { actorType: 'USER', userId: null },
        action: 'UPDATE',
        entityType: 'CLIENT',
        entityId: 'probe-user',
        entityLabel: 'probe',
      });
      await this.activity.record({
        actor: { actorType: 'SYSTEM', userId: null },
        action: 'SYSTEM_JOB',
        entityType: 'CLIENT',
        entityId: 'probe-system',
        entityLabel: 'probe',
      });
    });
    return { ok: true };
  }
}

@Module({ controllers: [RequestMetaProbeController] })
class RequestMetaProbeModule {}

const prisma = createTestPrisma();
let app: NestExpressApplication;

beforeAll(async () => {
  app = await createTestApp({ modules: [RequestMetaProbeModule], probes: false });
});
beforeEach(() => truncateBusinessTables(prisma));
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('request metadata reaches the activity writer (Q-BE2-5)', () => {
  it('stamps the USER entry with the caller ip and user agent, and the SYSTEM entry with none', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/request-meta-probe')
      .set('User-Agent', 'probe-agent/1.0')
      .expect(201);
    const rows = await prisma.activityLog.findMany({ orderBy: { entityId: 'asc' } });
    const user = rows.find((r) => r.entityId === 'probe-user');
    const system = rows.find((r) => r.entityId === 'probe-system');
    expect(user?.userAgent).toBe('probe-agent/1.0');
    expect(user?.ip).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
    expect(system?.ip).toBeNull();
    expect(system?.userAgent).toBeNull();
  });

  it('truncates a long user agent to 512 characters', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/request-meta-probe')
      .set('User-Agent', 'u'.repeat(2000))
      .expect(201);
    const user = await prisma.activityLog.findFirstOrThrow({ where: { entityId: 'probe-user' } });
    expect(user.userAgent).toHaveLength(512);
  });
});
