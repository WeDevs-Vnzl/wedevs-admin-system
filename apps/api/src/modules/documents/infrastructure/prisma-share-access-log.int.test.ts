import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { NewShareAccess } from '../application/ports/share-access-log.port';
import { PrismaShareAccessLog } from './prisma-share-access-log';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const log = new PrismaShareAccessLog(host);

const T0 = new Date('2026-10-30T12:00:00.000Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
let seq = 0;
const entry = (over: Partial<NewShareAccess> = {}): NewShareAccess => {
  seq += 1;
  return {
    id: `acc_${seq}`,
    shareLinkId: 'shr_a',
    event: 'VIEW',
    documentId: null,
    ipHash: 'h'.repeat(64),
    userAgent: 'Vitest',
    createdAt: T0,
    ...over,
  };
};
const append = (item: NewShareAccess) => uow.run(() => log.append(item));
const link = () => admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } });

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  const user = await admin.user.create({
    data: { clerkId: 'user_log', email: 'log@example.test', name: 'Autora', role: 'OWNER' },
  });
  await admin.shareLink.create({
    data: { id: 'shr_a', token: 'a'.repeat(43), title: 'Enlace', createdById: user.id },
  });
});

describe('PrismaShareAccessLog.append', () => {
  it('inserts the row with the caller clock and moves viewCount and lastAccessedAt', async () => {
    await append(entry({ event: 'VIEW', createdAt: at(3) }));
    expect(await link()).toMatchObject({ viewCount: 1, downloadCount: 0, lastAccessedAt: at(3) });
    const rows = await admin.shareAccessLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shareLinkId: 'shr_a',
      event: 'VIEW',
      documentId: null,
      userAgent: 'Vitest',
      createdAt: at(3),
    });
  });

  it('moves downloadCount for DOWNLOAD and no counter for UNLOCK_FAILED', async () => {
    await append(entry({ event: 'DOWNLOAD', createdAt: at(1) }));
    expect(await link()).toMatchObject({ viewCount: 0, downloadCount: 1, lastAccessedAt: at(1) });
    await append(entry({ event: 'UNLOCK_FAILED', createdAt: at(2) }));
    expect(await link()).toMatchObject({ viewCount: 0, downloadCount: 1, lastAccessedAt: at(1) });
    expect(await admin.shareAccessLog.count()).toBe(2);
  });

  it('is atomic: a failing insert rolls the counter back', async () => {
    await expect(
      uow.run(async () => {
        await log.append(entry({ event: 'VIEW' }));
        await log.append(entry({ event: 'VIEW', shareLinkId: 'shr_missing' }));
      }),
    ).rejects.toThrow();
    expect(await link()).toMatchObject({ viewCount: 0, lastAccessedAt: null });
    expect(await admin.shareAccessLog.count()).toBe(0);
  });

  it('refuses to write outside a unit of work', async () => {
    await expect(log.append(entry())).rejects.toThrow(/unit of work/);
  });
});

describe('PrismaShareAccessLog.convertToUnlock', () => {
  it('turns the failed row into UNLOCK and moves lastAccessedAt only', async () => {
    const failed = entry({ event: 'UNLOCK_FAILED', documentId: null, createdAt: at(1) });
    await append(failed);
    await uow.run(() => log.convertToUnlock(failed.id, 'shr_a', at(2)));
    const row = await admin.shareAccessLog.findUniqueOrThrow({ where: { id: failed.id } });
    expect(row.event).toBe('UNLOCK');
    expect(await link()).toMatchObject({ viewCount: 0, downloadCount: 0, lastAccessedAt: at(2) });
  });
});

describe('PrismaShareAccessLog.countFailures', () => {
  const failure = (over: Partial<NewShareAccess> = {}) =>
    append(entry({ event: 'UNLOCK_FAILED', documentId: 'doc_a', ...over }));
  const window = (since: Date, over: Record<string, string> = {}) => ({
    shareLinkId: 'shr_a',
    documentId: 'doc_a',
    ipHash: 'h'.repeat(64),
    since,
    ...over,
  });

  it('counts the UNLOCK_FAILED rows of this link, document and visitor strictly after the instant', async () => {
    await failure({ createdAt: at(0) });
    await failure({ createdAt: at(10) });
    await failure({ createdAt: at(14) });
    expect(await log.countFailures(window(at(-1)))).toBe(3);
    expect(await log.countFailures(window(at(0)))).toBe(2);
    expect(await log.countFailures(window(at(14)))).toBe(0);
  });

  it('ignores other documents, other visitors, other events and other links', async () => {
    await failure({ createdAt: at(1) });
    await failure({ createdAt: at(1), documentId: 'doc_b' });
    await failure({ createdAt: at(1), ipHash: 'z'.repeat(64) });
    await append(entry({ event: 'UNLOCK', documentId: 'doc_a', createdAt: at(1) }));
    await append(entry({ event: 'VIEW', documentId: 'doc_a', createdAt: at(1) }));
    expect(await log.countFailures(window(at(0)))).toBe(1);
    expect(await log.countFailures(window(at(0), { shareLinkId: 'shr_other' }))).toBe(0);
  });
});
