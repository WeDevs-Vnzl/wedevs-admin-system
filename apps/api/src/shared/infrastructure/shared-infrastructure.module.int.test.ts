import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, expect, it } from 'vitest';
import { APP_CONFIG } from '../../config/config.module';
import {
  ACTIVITY_LOG,
  CLOCK,
  ID_GENERATOR,
  SEQUENCE,
  UNIT_OF_WORK,
} from '../application/ports/tokens';
import type { ActivityLogPort } from '../application/ports/activity-log.port';
import type { ClockPort } from '../application/ports/clock.port';
import type { IdGeneratorPort } from '../application/ports/id-generator.port';
import type { SequencePort } from '../application/ports/sequence.port';
import type { UnitOfWorkPort } from '../application/ports/unit-of-work.port';
import { createTestPrisma, truncateBusinessTables } from '../../../test/support/db';
import { PrismaService } from './prisma/prisma.service';
import { TransactionHost } from './prisma/transaction-host';
import { SharedInfrastructureModule } from './shared-infrastructure.module';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: { DATABASE_URL: process.env.DATABASE_URL } }],
  exports: [APP_CONFIG],
})
class TestConfigModule {}

const admin = createTestPrisma();
afterAll(async () => {
  await admin.$disconnect();
});

it('binds every shared port token and exports PrismaService / TransactionHost', async () => {
  await truncateBusinessTables(admin);
  const moduleRef = await Test.createTestingModule({
    imports: [TestConfigModule, SharedInfrastructureModule],
  }).compile();
  await moduleRef.init();

  expect(moduleRef.get<ClockPort>(CLOCK).now()).toBeInstanceOf(Date);
  const ids = moduleRef.get<IdGeneratorPort>(ID_GENERATOR);
  expect(ids.next()).not.toBe(ids.next());
  expect(moduleRef.get(PrismaService)).toBeDefined();
  expect(moduleRef.get(TransactionHost)).toBeDefined();

  const uow = moduleRef.get<UnitOfWorkPort>(UNIT_OF_WORK);
  const code = await uow.run(async () => {
    const next = await moduleRef.get<SequencePort>(SEQUENCE).next('DOC');
    await moduleRef.get<ActivityLogPort>(ACTIVITY_LOG).record({
      actor: { actorType: 'SYSTEM', userId: null },
      action: 'CREATE',
      entityType: 'DOCUMENT',
      entityId: next,
      entityLabel: next,
    });
    return next;
  });
  expect(code).toBe('DOC-0001');
  expect(await admin.activityLog.count()).toBe(1);
  await moduleRef.close();
});
