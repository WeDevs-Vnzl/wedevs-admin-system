import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileAccessRegistry } from '../../src/modules/platform/application/file-access.registry';
import { CleanupFiles } from '../../src/modules/platform/application/use-cases/cleanup-files.use-case';
import { ReserveFileForAttachment } from '../../src/modules/platform/application/use-cases/reserve-file-for-attachment.use-case';
import { createPendingFile, type StoredFile } from '../../src/modules/platform/domain/file';
import { PrismaFileRepository } from '../../src/modules/platform/infrastructure/prisma-file.repository';
import type { Actor } from '../../src/shared/application/actor';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { PrismaActivityLog } from '../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaUnitOfWork } from '../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../src/shared/infrastructure/prisma/transaction-host';
import { Gate, gated } from '../commercial/concurrency/world';
import { makeNote, makeUser } from '../db/helpers';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { FakeAuthorization } from '../support/fakes/fake-authorization';
import { FixedClock } from '../support/fakes/fixed-clock';
import { InMemoryFileStorage } from '../support/fakes/in-memory-file-storage';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';

const SYSTEM: Actor = { actorType: 'SYSTEM', userId: null };
const NOW = '2026-10-25T10:00:00.000Z';

describe('CleanupFiles vs ReserveFileForAttachment (concurrency, int)', () => {
  const admin = createTestPrisma();
  let service: PrismaService;
  let host: TransactionHost;
  let repo: PrismaFileRepository;
  let uow: PrismaUnitOfWork;
  let storage: InMemoryFileStorage;
  let cleanup: CleanupFiles;
  let reserve: ReserveFileForAttachment;
  let user: CurrentUser;

  beforeAll(() => {
    service = new PrismaService({ DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL) });
  });
  beforeEach(async () => {
    await truncateBusinessTables(admin);
    host = new TransactionHost(service);
    repo = new PrismaFileRepository(host);
    uow = new PrismaUnitOfWork(host);
    storage = new InMemoryFileStorage();
    cleanup = new CleanupFiles(
      repo,
      storage,
      new PrismaActivityLog(host),
      uow,
      new FixedClock(NOW),
      () => undefined,
    );
    reserve = new ReserveFileForAttachment(new FakeAuthorization(), repo, new FileAccessRegistry());
    const row = await makeUser(admin);
    user = {
      userId: row.id,
      clerkId: row.clerkId,
      role: 'MEMBER',
      email: row.email,
      name: row.name,
    };
  });
  afterAll(async () => {
    await service.onModuleDestroy();
    await admin.$disconnect();
  });

  const oldPending = async (id: string): Promise<StoredFile> => {
    const file = createPendingFile({
      id,
      context: 'general',
      bucket: 'test',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      uploadedById: user.userId,
      now: new Date('2026-10-20T10:00:00Z'),
    });
    await repo.insert(file);
    return file;
  };

  /**
   * Observed state, not a timer: resolves once some backend is waiting on a row lock. Each poll is a query
   * round trip; the bound turns a missing wait into a failure instead of a hang.
   */
  const untilALockWaiter = async (): Promise<void> => {
    for (let i = 0; i < 5000; i += 1) {
      const rows = await admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if ((rows[0]?.n ?? 0n) > 0n) return;
    }
    throw new Error('no transaction ever waited on a lock');
  };

  it('a late confirm plus an attach holding the row lock make cleanup skip the file: the reference never dangles', async () => {
    const file = await oldPending('fil_race_1');
    const note = await makeNote(admin);
    const attached = new Gate();

    // The attach: confirm (PENDING -> READY), reserve under the file lock, link, and stay uncommitted.
    const attach = uow.run(async () => {
      await host.db.file.update({ where: { id: file.id }, data: { status: 'READY' } });
      await reserve.execute(user, file.id);
      await host.db.noteAttachment.create({ data: { noteId: note.id, fileId: file.id } });
      await attached.pause();
    });
    await attached.arrived;

    // The scan still sees the committed PENDING row; the recheck must wait for the attach, then skip.
    const run = cleanup.execute(SYSTEM);
    await untilALockWaiter();
    attached.release();
    await attach;
    const result = await run;

    expect(result).toEqual({ deleted: 0, skipped: 1, failed: 0 });
    const row = await admin.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.status).toBe('READY');
    expect(await admin.noteAttachment.count({ where: { fileId: file.id } })).toBe(1);
    expect(
      await admin.activityLog.count({ where: { entityType: 'FILE', action: 'SYSTEM_JOB' } }),
    ).toBe(0);
  });

  it('a cleanup holding the row lock makes a concurrent reserve wait, then answer NOT_FOUND', async () => {
    const file = await oldPending('fil_race_2');
    await repo.markReady(file.id, { sizeBytes: 10, mimeType: 'application/pdf' });
    await repo.softDelete(file.id, new Date('2026-10-20T11:00:00Z'));
    const removing = new Gate();
    const slowCleanup = new CleanupFiles(
      repo,
      storage,
      gated(new PrismaActivityLog(host), removing, ['record']),
      uow,
      new FixedClock(NOW),
      () => undefined,
    );

    const run = slowCleanup.execute(SYSTEM);
    await removing.arrived;
    const attach = uow
      .run(() => reserve.execute(user, file.id))
      .then(
        () => 'reserved',
        (e: { code?: string }) => e.code,
      );
    await untilALockWaiter();
    removing.release();

    expect(await run).toEqual({ deleted: 1, skipped: 0, failed: 0 });
    expect(await attach).toBe('NOT_FOUND');
    expect(await admin.file.count({ where: { id: file.id } })).toBe(0);
  });
});
