import { afterAll, beforeAll } from 'vitest';
import { PrismaEntityMetricsRead } from '../../../src/modules/intelligence/infrastructure/prisma-entity-metrics-read';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { entityMetricsReadContract } from '../../support/contracts/entity-metrics-read.contract';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);

beforeAll(() => truncateBusinessTables(admin));
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

async function reset(): Promise<void> {
  await truncateBusinessTables(admin);
}

async function ensureClient(id: string, extra: { tradeName?: string; deletedAt?: Date } = {}) {
  await admin.client.upsert({
    where: { id },
    update: {},
    create: {
      id,
      code: `CLI-${id}`,
      kind: 'EMPRESA',
      tradeName: extra.tradeName ?? id,
      legalName: id,
      taxId: id,
      country: 'US',
      address: 'x',
      phone: '1',
      ...(extra.deletedAt ? { deletedAt: extra.deletedAt } : {}),
    },
  });
}

entityMetricsReadContract('Prisma', async () => {
  await reset();
  return {
    port: new PrismaEntityMetricsRead(host),
    addClient: async (seed) => {
      await ensureClient(seed.id, {
        tradeName: seed.tradeName,
        ...(seed.archived ? { deletedAt: new Date('2026-06-01T00:00:00Z') } : {}),
      });
      await admin.client.update({
        where: { id: seed.id },
        data: { status: seed.status ?? 'ACTIVO' },
      });
      if (seed.metrics) {
        await admin.clientMetrics.create({ data: { clientId: seed.id, ...seed.metrics } });
      }
    },
    addProject: async (seed) => {
      await admin.project.create({
        data: {
          id: seed.id,
          code: `PRJ-${seed.id}`,
          name: seed.name,
          summary: 's',
          status: seed.status ?? 'EN_CURSO',
          ...(seed.archived ? { deletedAt: new Date('2026-06-01T00:00:00Z') } : {}),
        },
      });
      if (seed.metrics) {
        await admin.projectMetrics.create({ data: { projectId: seed.id, ...seed.metrics } });
      }
    },
  };
});
