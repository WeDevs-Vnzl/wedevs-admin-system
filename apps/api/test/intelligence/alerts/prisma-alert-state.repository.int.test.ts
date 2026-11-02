import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaAlertStateRepository } from '../../../src/modules/intelligence/infrastructure/prisma-alert-state.repository';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { makeUser } from '../../db/helpers';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';

const prisma = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const repo = new PrismaAlertStateRepository(
  new TransactionHost(service),
  new SequentialIdGenerator('ast'),
);
const T1 = new Date('2026-01-15T12:00:00.000Z');
const T2 = new Date('2026-01-16T12:00:00.000Z');
const K = 'INVOICE_OVERDUE:inv_1';

let userId = '';
let otherId = '';

beforeAll(() => truncateBusinessTables(prisma), 60_000);
beforeEach(async () => {
  await truncateBusinessTables(prisma);
  userId = (await makeUser(prisma)).id;
  otherId = (await makeUser(prisma)).id;
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(prisma);
  await service.client.$disconnect();
  await prisma.$disconnect();
});

const rows = () => prisma.alertState.findMany({ orderBy: { alertKey: 'asc' } });

describe('PrismaAlertStateRepository', () => {
  it('markRead creates the rows, keeps the first readAt and is idempotent', async () => {
    await repo.markRead(userId, [K, 'INVOICE_OVERDUE:inv_2'], T1);
    await repo.markRead(userId, [K], T2);
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored.find((r) => r.alertKey === K)).toMatchObject({
      userId,
      readAt: T1,
      dismissedAt: null,
      dismissedUntil: null,
    });
  });

  it('hide for good sets dismissedAt and clears dismissedUntil; a snooze swaps them; readAt is kept', async () => {
    await repo.markRead(userId, [K], T1);
    await repo.hide(userId, K, { dismissedAt: T2, dismissedUntil: null }, T2);
    expect(await rows()).toMatchObject([{ dismissedAt: T2, dismissedUntil: null, readAt: T1 }]);
    const until = new Date('2026-01-20T12:00:00.000Z');
    await repo.hide(userId, K, { dismissedAt: null, dismissedUntil: until }, T2);
    expect(await rows()).toMatchObject([{ dismissedAt: null, dismissedUntil: until, readAt: T1 }]);
    expect(await rows()).toHaveLength(1);
  });

  it('clearHiding clears both columns, keeps readAt, touches only the caller and ignores a missing row', async () => {
    await repo.markRead(userId, [K], T1);
    await repo.hide(userId, K, { dismissedAt: T2, dismissedUntil: null }, T2);
    await repo.hide(otherId, K, { dismissedAt: T2, dismissedUntil: null }, T2);
    await repo.clearHiding(userId, K);
    await repo.clearHiding(userId, 'INVOICE_OVERDUE:none');
    const stored = await rows();
    expect(stored).toHaveLength(2);
    expect(stored.find((r) => r.userId === userId)).toMatchObject({
      dismissedAt: null,
      dismissedUntil: null,
      readAt: T1,
    });
    expect(stored.find((r) => r.userId === otherId)?.dismissedAt).toEqual(T2);
  });

  it('listByUser is scoped by user and by the asked keys', async () => {
    await repo.markRead(userId, [K, 'INVOICE_OVERDUE:inv_2'], T1);
    await repo.markRead(otherId, [K], T1);
    const list = await repo.listByUser(userId, [K, 'INVOICE_OVERDUE:inv_9']);
    expect(list).toEqual([{ alertKey: K, readAt: T1, dismissedAt: null, dismissedUntil: null }]);
    expect(await repo.listByUser(userId, [])).toEqual([]);
  });

  it('a key with SQL metacharacters is inert (parameters only)', async () => {
    const evil = 'INVOICE_OVERDUE:x\'; DROP TABLE "AlertState"; --';
    await repo.markRead(userId, [evil], T1);
    await repo.hide(userId, evil, { dismissedAt: T1, dismissedUntil: null }, T1);
    expect(await rows()).toMatchObject([{ alertKey: evil }]);
  });
});
