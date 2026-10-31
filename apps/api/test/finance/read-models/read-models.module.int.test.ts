import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/config.module';
import { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import { RecomputeAll, SYSTEM_ACTOR } from '../../../src/modules/finance/application/recompute-all';
import { ReadModelsModule } from '../../../src/modules/finance/read-models.module';
import { SharedInfrastructureModule } from '../../../src/shared/infrastructure/shared-infrastructure.module';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: { DATABASE_URL: process.env.DATABASE_URL } }],
  exports: [APP_CONFIG],
})
class TestConfigModule {}

const admin = createTestPrisma();
beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await admin.$disconnect();
});

it('wires the projector and RecomputeAll over the Prisma adapters', async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TestConfigModule, SharedInfrastructureModule, ReadModelsModule],
  }).compile();
  await moduleRef.init();
  try {
    expect(moduleRef.get(FinanceProjector, { strict: false })).toBeInstanceOf(FinanceProjector);
    const result = await moduleRef.get(RecomputeAll, { strict: false }).execute(SYSTEM_ACTOR);
    expect(result).toEqual({
      counts: expect.objectContaining({ invoices: 0, clients: 0 }) as Record<string, number>,
      problems: [],
    });
  } finally {
    await moduleRef.close();
  }
});
