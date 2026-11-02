import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ShareAccessLogRetentionPort } from '../../../src/modules/documents/application/ports/share-access-log-retention.port';
import { PurgeShareAccessLog } from '../../../src/modules/documents/application/use-cases/shares/purge-share-access-log.use-case';
import { PrismaShareAccessLog } from '../../../src/modules/documents/infrastructure/prisma-share-access-log';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { Gate, gated } from '../../commercial/concurrency/world';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { assertLocalDatabaseUrl } from '../../support/local-db-guard';

/**
 * The purge against the portal's lockout over real PostgreSQL (C22, DT-45, DT-74): while a purge batch holds
 * its deletes uncommitted, failed unlock attempts keep being written and counted. Recent rows are never
 * touched, nobody waits for anybody, and the lockout holds before and after the purge commits.
 */
const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});

const SYSTEM = { actorType: 'SYSTEM', userId: null } as const;
const NOW = new Date('2026-10-30T12:00:00.000Z');
const IP = 'i'.repeat(64);
const LIMIT = 5;
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function world(retention: (port: ShareAccessLogRetentionPort) => ShareAccessLogRetentionPort) {
  const host = new TransactionHost(service);
  const uow = new PrismaUnitOfWork(host);
  const log = new PrismaShareAccessLog(host);
  return {
    uow,
    log,
    purge: new PurgeShareAccessLog(
      uow,
      retention(log),
      new PrismaActivityLog(host, new PrismaClientMetricsWriter(host)),
      new FixedClock(NOW),
    ),
  };
}

let seq = 0;
const failure = (createdAt: Date) => ({
  id: `acc_f${(seq += 1)}`,
  shareLinkId: 'shr_a',
  event: 'UNLOCK_FAILED' as const,
  documentId: 'doc_a',
  ipHash: IP,
  userAgent: null,
  createdAt,
});
const countWindow = (log: PrismaShareAccessLog) =>
  log.countFailures({
    shareLinkId: 'shr_a',
    documentId: 'doc_a',
    ipHash: IP,
    since: minutesAgo(15),
  });

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
  seq = 0;
  const user = await admin.user.create({
    data: { clerkId: 'user_con', email: 'con@example.test', name: 'Autora', role: 'OWNER' },
  });
  await admin.shareLink.create({
    data: { id: 'shr_a', token: 'a'.repeat(43), title: 'Enlace', createdById: user.id },
  });
  await admin.document.create({
    data: {
      id: 'doc_a',
      code: 'DOC-A',
      title: 'Documento',
      typeId: (await admin.documentType.findFirstOrThrow()).id,
    },
  });
  for (let i = 0; i < 3; i += 1) {
    await admin.shareAccessLog.create({ data: { ...failure(new Date(2020, 0, 1 + i)) } });
  }
  for (let i = 1; i < LIMIT; i += 1) {
    await admin.shareAccessLog.create({ data: { ...failure(minutesAgo(i)) } });
  }
});

describe('PurgeShareAccessLog against the lockout (C22)', () => {
  it('never touches recent rows while a batch is in flight; the lockout holds before and after', async () => {
    const gate = new Gate();
    const purging = world((port) => gated(port, gate, ['deleteCreatedBefore'], 'after'));
    const portal = world((port) => port);

    const run = purging.purge.execute(SYSTEM);
    await gate.arrived; // the old rows are deleted in an uncommitted transaction

    // A fifth failed attempt arrives now: it writes and counts without waiting for the purge.
    await portal.uow.run(() => portal.log.append(failure(minutesAgo(0))));
    expect(await countWindow(portal.log)).toBe(LIMIT);

    gate.release();
    const result = await run;

    expect(result.deleted).toBe(3);
    expect(await countWindow(portal.log)).toBe(LIMIT);
    expect(await admin.shareAccessLog.count()).toBe(LIMIT);
    expect(await admin.shareAccessLog.count({ where: { createdAt: { lt: result.cutoff } } })).toBe(
      0,
    );
  });

  it('does not wait for an unlock conversion on a recent row, and the conversion survives', async () => {
    const gate = new Gate();
    const purging = world((port) => gated(port, gate, ['deleteCreatedBefore'], 'after'));
    const portal = world((port) => port);
    const recent = failure(minutesAgo(1));
    await admin.shareAccessLog.create({ data: recent });

    const run = purging.purge.execute(SYSTEM);
    await gate.arrived;
    await portal.uow.run(() => portal.log.convertToUnlock(recent.id, 'shr_a', NOW));
    gate.release();
    await run;

    expect(
      await admin.shareAccessLog.findUniqueOrThrow({ where: { id: recent.id } }),
    ).toMatchObject({ event: 'UNLOCK' });
  });

  it('two purges at once delete each row once and never fail', async () => {
    const a = world((port) => port);
    const b = world((port) => port);
    const [one, two] = await Promise.all([a.purge.execute(SYSTEM), b.purge.execute(SYSTEM)]);
    expect(one.deleted + two.deleted).toBe(3);
    expect(await admin.shareAccessLog.count()).toBe(LIMIT - 1);
  });
});
