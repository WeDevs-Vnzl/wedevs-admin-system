import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileAccessRegistry } from '../application/file-access.registry';
import { DeleteFile } from '../application/use-cases/delete-file.use-case';
import { ReserveFileForAttachment } from '../application/use-cases/reserve-file-for-attachment.use-case';
import { FakeAuthorization } from '../../../../test/support/fakes/fake-authorization';
import { FixedClock } from '../../../../test/support/fakes/fixed-clock';
import { InMemoryFileStorage } from '../../../../test/support/fakes/in-memory-file-storage';
import { PrismaActivityLog } from '../../../shared/infrastructure/prisma/prisma-activity-log';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import type { CurrentUser } from '../../../shared/application/current-user';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { makeNote, makeUser } from '../../../../test/db/helpers';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { createPendingFile, type StoredFile } from '../domain/file';
import { PrismaFileRepository } from './prisma-file.repository';

describe('PrismaFileRepository (int)', () => {
  const admin = createTestPrisma();
  let service: PrismaService;
  let repo: PrismaFileRepository;
  let userId: string;
  let counter = 0;

  const newFile = (): StoredFile =>
    createPendingFile({
      id: `fil_int_${++counter}`,
      context: 'general',
      bucket: 'test',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      uploadedById: userId,
      now: new Date('2026-10-25T10:00:00Z'),
    });

  beforeAll(() => {
    service = new PrismaService({ DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL) });
    repo = new PrismaFileRepository(new TransactionHost(service));
  });
  beforeEach(async () => {
    await truncateBusinessTables(admin);
    userId = (await makeUser(admin)).id;
  });
  afterAll(async () => {
    await service.onModuleDestroy();
    await admin.$disconnect();
  });

  it('inserts a PENDING file and reads it back', async () => {
    const file = newFile();
    await repo.insert(file);
    expect(await repo.findById(file.id)).toEqual(file);
    expect(await repo.findById('unknown')).toBeNull();
  });

  it('marks READY once with the verified size and type', async () => {
    const file = newFile();
    await repo.insert(file);
    expect(await repo.markReady(file.id, { sizeBytes: 999, mimeType: 'application/pdf' })).toBe(
      true,
    );
    expect(await repo.findById(file.id)).toMatchObject({ status: 'READY', sizeBytes: 999 });
    expect(await repo.markReady(file.id, { sizeBytes: 1, mimeType: 'application/pdf' })).toBe(
      false,
    );
  });

  it('soft-deletes: the row stays with deletedAt, reads and transitions skip it', async () => {
    const file = newFile();
    await repo.insert(file);
    const at = new Date('2026-10-25T11:00:00Z');
    expect(await repo.softDelete(file.id, at)).toBe(true);
    expect(await repo.softDelete(file.id, at)).toBe(false);
    expect(await repo.findById(file.id)).toBeNull();
    expect(await repo.markReady(file.id, { sizeBytes: 1, mimeType: 'x/y' })).toBe(false);
    const raw = await admin.file.findUnique({ where: { id: file.id } });
    expect(raw?.deletedAt).toEqual(at);
  });

  it('detects business rows that reference the file', async () => {
    const plain = newFile();
    const attached = newFile();
    await repo.insert(plain);
    await repo.insert(attached);
    expect(await repo.isReferenced(plain.id)).toBe(false);

    const note = await makeNote(admin);
    await admin.noteAttachment.create({ data: { noteId: note.id, fileId: attached.id } });
    expect(await repo.isReferenced(attached.id)).toBe(true);
    expect(await repo.isReferenced('unknown')).toBe(false);
  });

  describe('cleanup reads (DT-145)', () => {
    const cutoff = new Date('2026-10-24T10:00:00Z');
    const at = (iso: string) => new Date(iso);
    const make = async (id: string, over: Partial<StoredFile> = {}): Promise<StoredFile> => {
      const file = { ...newFile(), id, storageKey: `general/2026/10/${id}`, ...over };
      await repo.insert(file);
      if (over.status === 'READY') {
        await repo.markReady(id, { sizeBytes: 10, mimeType: 'application/pdf' });
      }
      if (over.deletedAt) await repo.softDelete(id, over.deletedAt);
      return file;
    };

    it('finds old PENDING and old soft-deleted unreferenced files, oldest first, within the limit', async () => {
      await make('c_pending_old', { createdAt: at('2026-10-20T10:00:00Z') });
      await make('c_pending_older', { createdAt: at('2026-10-19T10:00:00Z') });
      await make('c_pending_new', { createdAt: at('2026-10-25T09:00:00Z') });
      await make('c_ready', { status: 'READY', createdAt: at('2026-10-01T10:00:00Z') });
      await make('c_deleted_old', {
        status: 'READY',
        createdAt: at('2026-10-21T10:00:00Z'),
        deletedAt: at('2026-10-22T10:00:00Z'),
      });
      await make('c_deleted_new', {
        status: 'READY',
        createdAt: at('2026-10-21T10:00:00Z'),
        deletedAt: at('2026-10-25T09:00:00Z'),
      });

      const all = await repo.findCleanupCandidates(cutoff, 10);
      expect(all.map((c) => c.id)).toEqual(['c_pending_older', 'c_pending_old', 'c_deleted_old']);
      expect(all[0]).toEqual({
        id: 'c_pending_older',
        storageKey: 'general/2026/10/c_pending_older',
      });
      expect(await repo.findCleanupCandidates(cutoff, 2)).toHaveLength(2);
    });

    it('leaves out referenced files, deleted or not', async () => {
      const kept = await make('c_kept', {
        status: 'READY',
        createdAt: at('2026-10-20T10:00:00Z'),
        deletedAt: at('2026-10-21T10:00:00Z'),
      });
      const note = await makeNote(admin);
      await admin.noteAttachment.create({ data: { noteId: note.id, fileId: kept.id } });
      await make('c_free', { createdAt: at('2026-10-20T10:00:00Z') });
      expect((await repo.findCleanupCandidates(cutoff, 10)).map((c) => c.id)).toEqual(['c_free']);
    });

    it('lockForCleanup sees deleted rows and needs a unit of work; hardDelete removes the row', async () => {
      const host = new TransactionHost(service);
      const uow = new PrismaUnitOfWork(host);
      const file = await make('c_lock', {
        status: 'READY',
        deletedAt: at('2026-10-21T10:00:00Z'),
      });
      const scoped = new PrismaFileRepository(host);
      await expect(scoped.lockForCleanup(file.id)).rejects.toThrow();
      await expect(scoped.hardDelete(file.id)).rejects.toThrow();
      const locked = await uow.run(() => scoped.lockForCleanup(file.id));
      expect(locked).toMatchObject({ id: file.id, deletedAt: at('2026-10-21T10:00:00Z') });
      expect(await uow.run(() => scoped.lockForCleanup('unknown'))).toBeNull();
      expect(await uow.run(() => scoped.hardDelete(file.id))).toBe(true);
      expect(await uow.run(() => scoped.hardDelete(file.id))).toBe(false);
      expect(await admin.file.count({ where: { id: file.id } })).toBe(0);
    });
  });

  describe('row lock shared by ReserveFileForAttachment and DeleteFile', () => {
    const settle = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
    const pending = async (p: Promise<unknown>) =>
      (await Promise.race([
        p.then(
          () => 'done',
          () => 'done',
        ),
        settle().then(() => 'pending'),
      ])) === 'pending';

    let uow: PrismaUnitOfWork;
    let host: TransactionHost;
    let reserve: ReserveFileForAttachment;
    let deleteFile: DeleteFile;
    let user: CurrentUser;
    let stranger: CurrentUser;

    beforeEach(async () => {
      host = new TransactionHost(service);
      repo = new PrismaFileRepository(host);
      uow = new PrismaUnitOfWork(host);
      const registry = new FileAccessRegistry();
      const authorization = new FakeAuthorization();
      reserve = new ReserveFileForAttachment(authorization, repo, registry);
      deleteFile = new DeleteFile(
        authorization,
        repo,
        registry,
        new InMemoryFileStorage(),
        new PrismaActivityLog(host),
        uow,
        new FixedClock('2026-10-25T10:00:00.000Z'),
        () => undefined,
      );
      const row = await admin.user.findUniqueOrThrow({ where: { id: userId } });
      user = {
        userId,
        clerkId: row.clerkId,
        role: 'MEMBER',
        email: row.email,
        name: row.name,
      };
      stranger = { ...user, userId: (await makeUser(admin)).id };
    });

    const readyFile = async (): Promise<StoredFile> => {
      const file = newFile();
      await repo.insert(file);
      await repo.markReady(file.id, { sizeBytes: 10, mimeType: 'application/pdf' });
      return file;
    };

    it('lockForUpdate needs a unit of work and hides unknown and deleted rows', async () => {
      const file = await readyFile();
      await expect(repo.lockForUpdate(file.id)).rejects.toThrow();
      expect(await uow.run(() => repo.lockForUpdate(file.id))).toMatchObject({ id: file.id });
      expect(await uow.run(() => repo.lockForUpdate('unknown'))).toBeNull();
      await repo.softDelete(file.id, new Date());
      expect(await uow.run(() => repo.lockForUpdate(file.id))).toBeNull();
    });

    it('an attach holding the lock makes a concurrent delete wait, then fail its unattached check', async () => {
      const file = await readyFile();
      const note = await makeNote(admin);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => (locked = resolve));

      const attach = uow.run(async () => {
        await reserve.execute(user, file.id);
        locked();
        await gate;
        // Same transaction: a second connection would wait on the FOR UPDATE lock (FK key-share).
        await host.db.noteAttachment.create({ data: { noteId: note.id, fileId: file.id } });
      });
      await hasLock;

      const del = deleteFile.execute(user, { fileId: file.id });
      const delResult = del.then(
        () => 'deleted',
        (e: { code?: string }) => e.code,
      );
      expect(await pending(del)).toBe(true);

      release();
      await attach;
      expect(await delResult).toBe('INTEGRITY_LOCK');
      const raw = await admin.file.findUniqueOrThrow({ where: { id: file.id } });
      expect(raw.deletedAt).toBeNull();
    });

    it('a delete holding the lock makes a concurrent attach wait, then answer NOT_FOUND', async () => {
      const file = await readyFile();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => (locked = resolve));

      const removal = uow.run(async () => {
        await repo.lockForUpdate(file.id);
        locked();
        await gate;
        await repo.softDelete(file.id, new Date());
      });
      await hasLock;

      const attach = uow.run(() => reserve.execute(user, file.id));
      const attachResult = attach.then(
        () => 'reserved',
        (e: { code?: string }) => e.code,
      );
      expect(await pending(attach)).toBe(true);

      release();
      await removal;
      expect(await attachResult).toBe('NOT_FOUND');
    });

    it('answers NOT_FOUND for another user’s file and for a PENDING file', async () => {
      const ready = await readyFile();
      const pendingFile = newFile();
      await repo.insert(pendingFile);
      await expect(uow.run(() => reserve.execute(stranger, ready.id))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(uow.run(() => reserve.execute(user, pendingFile.id))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await uow.run(() => reserve.execute(user, ready.id))).toEqual({
        id: ready.id,
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      });
    });
  });
});
