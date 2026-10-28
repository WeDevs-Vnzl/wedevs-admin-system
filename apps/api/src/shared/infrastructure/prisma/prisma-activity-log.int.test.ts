import { afterAll, beforeAll } from 'vitest';
import { activitySeamsContract } from '../../../../test/support/contracts/activity-seams.contract';
import { FixedRequestContext } from '../../../../test/support/fakes/fixed-request-context';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaActivityLog } from './prisma-activity-log';
import { PrismaClientMetricsWriter } from './prisma-client-metrics-writer';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { TransactionHost } from './transaction-host';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const requestContext = new FixedRequestContext();
const activityLog = new PrismaActivityLog(
  host,
  new PrismaClientMetricsWriter(host),
  requestContext,
);

beforeAll(() => truncateBusinessTables(admin));
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

activitySeamsContract('Prisma', async () => {
  await truncateBusinessTables(admin);
  requestContext.set(null);
  return {
    uow,
    activityLog,
    setRequest: (meta) => requestContext.set(meta),
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
    lastActivityAt: async (id) =>
      (await admin.clientMetrics.findUnique({ where: { clientId: id } }))?.lastActivityAt ?? null,
    readActivity: async () => {
      const rows = await admin.activityLog.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map((r) => ({
        actor: { actorType: r.actorType, userId: r.actorId },
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        entityLabel: r.entityLabel,
        clientId: r.clientId,
        ip: r.ip,
        userAgent: r.userAgent,
      }));
    },
  };
});
