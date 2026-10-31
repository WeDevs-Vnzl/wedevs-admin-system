import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const newClient = (id: string) => ({
  id,
  code: `CLI-${id}`,
  kind: 'EMPRESA' as const,
  tradeName: id,
  legalName: id,
  taxId: id,
  country: 'US',
  address: 'x',
  phone: '1',
});

/** Resolves once some backend is waiting on a lock (condition polling, not a timed wait). */
async function untilSomeoneWaitsOnALock(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const rows = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (rows[0] && rows[0].n > 0n) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('nobody waited on a lock');
}

describe('touchActivity lock order (BE-3 deadlock fix)', () => {
  it('touches the metrics rows in ascending client id, so an overlapping writer cannot deadlock it', async () => {
    await truncateBusinessTables(admin);
    // Physical order c2, c1: a plain scan of "Client" would visit c2 first.
    await admin.client.create({ data: newClient('c2') });
    await admin.client.create({ data: newClient('c1') });
    await admin.clientMetrics.createMany({ data: [{ clientId: 'c1' }, { clientId: 'c2' }] });

    let holderHasC1!: () => void;
    const c1Held = new Promise<void>((resolve) => (holderHasC1 = resolve));
    let releaseHolder!: () => void;
    const holderMayContinue = new Promise<void>((resolve) => (releaseHolder = resolve));
    // The other writer (the projector of BE-3): ascending order, c1 then c2.
    const holder = admin.$transaction(async (tx) => {
      await tx.clientMetrics.update({ where: { clientId: 'c1' }, data: { projectCount: 1 } });
      holderHasC1();
      await holderMayContinue;
      await tx.clientMetrics.update({ where: { clientId: 'c2' }, data: { projectCount: 1 } });
    });
    await c1Held;

    const touch = uow.run(() =>
      metrics.touchActivity(['c1', 'c2'], new Date('2026-10-01T10:00:00.000Z')),
    );
    await untilSomeoneWaitsOnALock();
    releaseHolder();

    await expect(Promise.all([holder, touch])).resolves.toBeDefined();
    const rows = await admin.clientMetrics.findMany({ orderBy: { clientId: 'asc' } });
    expect(rows.map((r) => r.lastActivityAt?.toISOString())).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T10:00:00.000Z',
    ]);
  });
});
