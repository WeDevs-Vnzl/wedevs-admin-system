import { afterAll, beforeAll } from 'vitest';
import { clientMetricsWriterContract } from '../../../../test/support/contracts/client-metrics-writer.contract';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaClientMetricsWriter } from './prisma-client-metrics-writer';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { TransactionHost } from './transaction-host';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const metrics = new PrismaClientMetricsWriter(host);

beforeAll(() => truncateBusinessTables(admin));
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

clientMetricsWriterContract('Prisma', async () => {
  await truncateBusinessTables(admin);
  return {
    uow,
    metrics,
    createClient: async (id) => {
      await admin.client.create({
        data: {
          id,
          code: `CLI-${id}`,
          kind: 'EMPRESA',
          tradeName: id,
          legalName: id,
          taxId: id,
          country: 'US',
          address: 'x',
          phone: '1',
        },
      });
    },
    seedReceivable: async (id, value) => {
      await admin.clientMetrics.update({ where: { clientId: id }, data: { receivableUsd: value } });
    },
    read: async (id) => {
      const row = await admin.clientMetrics.findUnique({ where: { clientId: id } });
      return row
        ? {
            projectCount: row.projectCount,
            lastActivityAt: row.lastActivityAt,
            receivableUsd: row.receivableUsd.toFixed(2),
          }
        : null;
    },
  };
});
