import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { sampleEntry } from '../../../../test/support/contracts/unit-of-work.contract';
import { PrismaActivityLog } from './prisma-activity-log';
import { archivedWhere } from './prisma-list';
import { PrismaService } from './prisma.service';
import { TransactionHost } from './transaction-host';
import { PrismaUnitOfWork } from './prisma-unit-of-work';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const db = service.client;

const base = {
  kind: 'PERSONA',
  legalName: 'L',
  taxId: 'V-1',
  country: 'VE',
  address: 'a',
  phone: '1',
} as const;

beforeEach(async () => {
  await truncateBusinessTables(admin);
  await admin.client.createMany({
    data: [
      { ...base, code: 'CLI-0001', tradeName: 'Alive' },
      { ...base, code: 'CLI-0002', tradeName: 'Archived', deletedAt: new Date() },
    ],
  });
});
afterAll(async () => {
  await db.$disconnect();
  await admin.$disconnect();
});

describe('soft-delete extension', () => {
  it('excludes archived rows by default in every filtered read', async () => {
    expect((await db.client.findMany()).map((c) => c.tradeName)).toEqual(['Alive']);
    expect(await db.client.findFirst({ where: { tradeName: 'Archived' } })).toBeNull();
    await expect(
      db.client.findFirstOrThrow({ where: { tradeName: 'Archived' } }),
    ).rejects.toThrow();
    expect(await db.client.count()).toBe(1);
    expect((await db.client.aggregate({ _count: true }))._count).toBe(1);
    const groups = await db.client.groupBy({ by: ['kind'], _count: true });
    expect(groups).toEqual([{ kind: 'PERSONA', _count: 1 }]);
  });

  it('archived only / include go through the list helper', async () => {
    const only = await db.client.findMany({ where: archivedWhere('only') });
    expect(only.map((c) => c.tradeName)).toEqual(['Archived']);
    const all = await db.client.findMany({ where: archivedWhere('include') });
    expect(all).toHaveLength(2);
    expect(await db.client.count({ where: archivedWhere('include') })).toBe(2);
    expect(await db.client.count({ where: archivedWhere('exclude') })).toBe(1);
  });

  it('keeps other filters when adding the default', async () => {
    expect(await db.client.count({ where: { kind: 'EMPRESA' } })).toBe(0);
    expect(
      await db.client.count({ where: { OR: [{ tradeName: 'Alive' }, { tradeName: 'Archived' }] } }),
    ).toBe(1);
  });

  it('does not filter findUnique (repositories check deletedAt, C14)', async () => {
    const row = await db.client.findUnique({ where: { code: 'CLI-0002' } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it('leaves non-soft-delete models untouched (ActivityLog)', async () => {
    const host = new TransactionHost(service);
    const uow = new PrismaUnitOfWork(host);
    await uow.run(() => new PrismaActivityLog(host).record(sampleEntry('x')));
    expect(await db.activityLog.count()).toBe(1);
    expect(await db.activityLog.findMany({ where: { entityId: 'x' } })).toHaveLength(1);
  });

  it('applies inside a transaction client too', async () => {
    const count = await db.$transaction((tx) => tx.client.count());
    expect(count).toBe(1);
  });
});
