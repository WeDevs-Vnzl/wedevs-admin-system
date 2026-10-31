import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rowLocksContract } from '../../../../test/support/contracts/row-locks.contract';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { PrismaRowLocks } from './prisma-row-locks';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { TransactionHost } from './transaction-host';

const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const locks = new PrismaRowLocks(host);

beforeAll(() => truncateBusinessTables(admin));
afterAll(async () => {
  await service.client.$disconnect();
  await admin.$disconnect();
});

rowLocksContract('Prisma', () => ({ uow, locks }));

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

describe('PrismaRowLocks (Postgres)', () => {
  it('takes the rows of a class in ascending id order, whatever the order requested', async () => {
    await truncateBusinessTables(admin);
    await admin.client.createMany({ data: [newClient('c1'), newClient('c2')] });

    let releaseHolder!: () => void;
    const holderMayEnd = new Promise<void>((resolve) => (releaseHolder = resolve));
    let holderLocked!: () => void;
    const holderHasC1 = new Promise<void>((resolve) => (holderLocked = resolve));
    const holder = admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = 'c1' FOR UPDATE`;
      holderLocked();
      await holderMayEnd;
    });
    await holderHasC1;

    // Requested [c2, c1]: ascending order blocks on c1 without having taken c2.
    const locker = uow.run(() => locks.lock({ Client: ['c2', 'c1'] }));
    await untilSomeoneWaitsOnALock();
    const probe = await admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = 'c2' FOR UPDATE NOWAIT`;
      return 'c2 was free';
    });
    expect(probe).toBe('c2 was free');

    releaseHolder();
    await holder;
    await locker;
  });

  it('takes the classes in the global order: Project before Client', async () => {
    await truncateBusinessTables(admin);
    await admin.client.create({ data: newClient('c1') });
    const project = await admin.project.create({
      data: { code: 'PRJ-1', name: 'p', summary: 's' },
    });

    let releaseHolder!: () => void;
    const holderMayEnd = new Promise<void>((resolve) => (releaseHolder = resolve));
    let holderLocked!: () => void;
    const holderHasProject = new Promise<void>((resolve) => (holderLocked = resolve));
    const holder = admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "id" = ${project.id} FOR UPDATE`;
      holderLocked();
      await holderMayEnd;
    });
    await holderHasProject;

    const locker = uow.run(() => locks.lock({ Client: ['c1'], Project: [project.id] }));
    await untilSomeoneWaitsOnALock();
    const probe = await admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = 'c1' FOR UPDATE NOWAIT`;
      return 'client was free';
    });
    expect(probe).toBe('client was free');

    releaseHolder();
    await holder;
    await locker;
  });

  it('two units of work locking the same clients in opposite order both commit', async () => {
    await truncateBusinessTables(admin);
    await admin.client.createMany({ data: [newClient('c1'), newClient('c2')] });
    await Promise.all([
      uow.run(() => locks.lock({ Client: ['c1', 'c2'] })),
      uow.run(() => locks.lock({ Client: ['c2', 'c1'] })),
    ]);
  });
});
