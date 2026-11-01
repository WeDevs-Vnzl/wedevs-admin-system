import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryFileCleanupRepository } from '../../../../../test/platform/cleanup-files.fake';
import { FixedClock } from '../../../../../test/support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../../../../test/support/fakes/in-memory-activity-log';
import { InMemoryFileStorage } from '../../../../../test/support/fakes/in-memory-file-storage';
import { InMemoryUnitOfWork } from '../../../../../test/support/fakes/in-memory-unit-of-work';
import type { Actor } from '../../../../shared/application/actor';
import type { StoredFile } from '../../domain/file';
import { CLEANUP_BATCH_SIZE, CleanupFiles } from './cleanup-files.use-case';

const SYSTEM: Actor = { actorType: 'SYSTEM', userId: null };
const NOW = '2026-10-25T10:00:00.000Z';
const hoursAgo = (h: number) => new Date(new Date(NOW).getTime() - h * 3_600_000);

const file = (id: string, over: Partial<StoredFile> = {}): StoredFile => ({
  id,
  storageKey: `general/2026/10/${id}`,
  bucket: 'memory',
  originalName: `${id}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 10,
  status: 'PENDING',
  uploadedById: 'usr_1',
  createdAt: hoursAgo(30),
  deletedAt: null,
  ...over,
});

describe('CleanupFiles', () => {
  let files: InMemoryFileCleanupRepository;
  let storage: InMemoryFileStorage;
  let uow: InMemoryUnitOfWork;
  let activity: InMemoryActivityLog;
  let failures: { fileId: string }[];
  let cleanup: CleanupFiles;

  beforeEach(() => {
    files = new InMemoryFileCleanupRepository();
    storage = new InMemoryFileStorage();
    uow = new InMemoryUnitOfWork();
    activity = new InMemoryActivityLog(uow);
    failures = [];
    cleanup = new CleanupFiles(
      files,
      storage,
      activity,
      uow,
      new FixedClock(NOW),
      (_error, context) => failures.push(context),
    );
  });

  it('refuses any actor but SYSTEM (DT-130)', async () => {
    await expect(cleanup.execute({ actorType: 'USER', userId: 'usr_1' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(cleanup.execute({ actorType: 'PUBLIC', userId: null })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('removes PENDING files older than 24 h and soft-deleted unreferenced ones, destroying the asset first', async () => {
    files.add(file('old_pending'));
    files.add(file('old_deleted', { status: 'READY', deletedAt: hoursAgo(25) }));
    files.add(file('fresh_pending', { createdAt: hoursAgo(23) }));
    files.add(file('fresh_deleted', { status: 'READY', deletedAt: hoursAgo(1) }));
    files.add(file('ready', { status: 'READY' }));
    storage.put('general/2026/10/old_pending', new Uint8Array([1]));

    const result = await cleanup.execute(SYSTEM);

    expect(result).toEqual({ deleted: 2, skipped: 0, failed: 0 });
    expect([...files.rows.keys()].sort()).toEqual(['fresh_deleted', 'fresh_pending', 'ready']);
    expect(storage.destroyed.sort()).toEqual([
      'general/2026/10/old_deleted',
      'general/2026/10/old_pending',
    ]);
    expect(activity.entries).toHaveLength(2);
    expect(activity.entries.find((e) => e.entityId === 'old_pending')).toMatchObject({
      actor: SYSTEM,
      action: 'SYSTEM_JOB',
      entityType: 'FILE',
      entityId: 'old_pending',
      metadata: { reason: 'PENDING_EXPIRED' },
    });
    expect(activity.entries.find((e) => e.entityId === 'old_deleted')).toMatchObject({
      metadata: { reason: 'DELETED' },
    });
  });

  it('never removes a referenced file, even soft-deleted', async () => {
    files.add(file('attached', { status: 'READY', deletedAt: hoursAgo(48) }));
    files.referenced.add('attached');
    const result = await cleanup.execute(SYSTEM);
    expect(result).toEqual({ deleted: 0, skipped: 0, failed: 0 });
    expect(files.rows.has('attached')).toBe(true);
    expect(storage.destroyed).toEqual([]);
  });

  it('a file confirmed or attached after the scan is skipped under the lock, leaving its row', async () => {
    files.add(file('late'));
    const scan = files.findCleanupCandidates.bind(files);
    files.findCleanupCandidates = async (cutoff, limit) => {
      const found = await scan(cutoff, limit);
      // The late confirm and a reference land between the scan and the locked recheck.
      files.rows.set('late', { ...file('late'), status: 'READY' });
      files.referenced.add('late');
      return found;
    };
    const result = await cleanup.execute(SYSTEM);
    expect(result).toEqual({ deleted: 0, skipped: 1, failed: 0 });
    expect(files.rows.get('late')?.status).toBe('READY');
    expect(files.locked).toEqual(['late']);
    expect(storage.destroyed).toEqual([]);
    expect(activity.entries).toHaveLength(0);
  });

  it('a late confirm alone (no reference yet) also keeps the row', async () => {
    files.add(file('late'));
    const scan = files.findCleanupCandidates.bind(files);
    files.findCleanupCandidates = async (cutoff, limit) => {
      const found = await scan(cutoff, limit);
      files.rows.set('late', { ...file('late'), status: 'READY' });
      return found;
    };
    expect(await cleanup.execute(SYSTEM)).toEqual({ deleted: 0, skipped: 1, failed: 0 });
    expect(files.rows.has('late')).toBe(true);
    expect(files.rows.get('late')?.deletedAt).toBeNull();
    expect(storage.destroyed).toEqual([]);
  });

  it('soft-deletes the row before destroying the asset, so a confirm can no longer flip it', async () => {
    files.add(file('a'));
    const destroy = storage.destroy.bind(storage);
    let deletedAtDuringDestroy: Date | null | undefined;
    storage.destroy = (key) => {
      deletedAtDuringDestroy = files.rows.get('a')?.deletedAt;
      return destroy(key);
    };
    expect(await cleanup.execute(SYSTEM)).toEqual({ deleted: 1, skipped: 0, failed: 0 });
    expect(deletedAtDuringDestroy).toEqual(new Date(NOW));
    expect(files.rows.has('a')).toBe(false);
  });

  it('a failed destroy skips that file for the next run and does not abort the run', async () => {
    files.add(file('a'));
    files.add(file('b', { createdAt: hoursAgo(29) }));
    const destroy = storage.destroy.bind(storage);
    storage.destroy = (key) =>
      key.endsWith('/b') ? Promise.reject(new Error('storage unavailable')) : destroy(key);

    const result = await cleanup.execute(SYSTEM);

    expect(result).toEqual({ deleted: 1, skipped: 0, failed: 1 });
    expect(failures).toEqual([{ fileId: 'b', storageKey: 'general/2026/10/b' }]);
    expect(files.rows.get('b')?.deletedAt).toEqual(new Date(NOW));
    expect(files.rows.has('a')).toBe(false);

    // The row is now a soft-deleted file, so it comes back once its deletion is 24 h old (DT-145).
    storage.destroy = destroy;
    expect(await cleanup.execute(SYSTEM)).toEqual({ deleted: 0, skipped: 0, failed: 0 });
    const nextDay = new CleanupFiles(
      files,
      storage,
      activity,
      uow,
      new FixedClock('2026-10-26T10:00:01.000Z'),
      (_error, context) => failures.push(context),
    );
    expect(await nextDay.execute(SYSTEM)).toEqual({ deleted: 1, skipped: 0, failed: 0 });
    expect(files.rows.size).toBe(0);
    expect(activity.entries.find((e) => e.entityId === 'b')).toMatchObject({
      metadata: { reason: 'DELETED' },
    });
  });

  it('a rerun is a no-op', async () => {
    files.add(file('a'));
    expect((await cleanup.execute(SYSTEM)).deleted).toBe(1);
    expect(await cleanup.execute(SYSTEM)).toEqual({ deleted: 0, skipped: 0, failed: 0 });
    expect(activity.entries).toHaveLength(1);
  });

  it('handles a bounded batch per run, oldest first', async () => {
    for (let i = 0; i < CLEANUP_BATCH_SIZE + 5; i += 1) {
      files.add(
        file(`f${String(i).padStart(4, '0')}`, { createdAt: new Date(1_700_000_000_000 + i) }),
      );
    }
    expect((await cleanup.execute(SYSTEM)).deleted).toBe(CLEANUP_BATCH_SIZE);
    expect(files.rows.size).toBe(5);
    expect((await cleanup.execute(SYSTEM)).deleted).toBe(5);
  });
});
