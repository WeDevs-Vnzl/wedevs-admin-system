import type { Actor } from '../../../../shared/application/actor';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ForbiddenError } from '../../../../shared/domain/domain-error';
import type { StoredFile } from '../../domain/file';
import type { FileCleanupRepository } from '../ports/file.repository.port';
import type { FileStoragePort } from '../ports/file-storage.port';

/** A `PENDING` upload or a soft-deleted file is only removed once it is this old. */
export const CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** Files handled per run; the rest wait for the next one. */
export const CLEANUP_BATCH_SIZE = 200;

export interface CleanupFilesResult {
  /** Rows removed (row soft-deleted, asset destroyed, then row deleted). */
  readonly deleted: number;
  /** Candidates that were no longer eligible under the lock (confirmed, referenced, already gone). */
  readonly skipped: number;
  /** Candidates whose destroy or delete failed; they stay for the next run. */
  readonly failed: number;
}

export type CleanupFailureReporter = (
  error: unknown,
  context: { readonly fileId: string; readonly storageKey: string },
) => void;

/** The cleanup rule, evaluated again under the row lock: an unreferenced file, old enough, that is `PENDING` or deleted. */
export function isCleanupEligible(file: StoredFile, referenced: boolean, cutoff: Date): boolean {
  if (referenced) return false;
  if (file.deletedAt !== null) return file.deletedAt < cutoff;
  return file.status === 'PENDING' && file.createdAt < cutoff;
}

/**
 * PRD §12 `cleanup-files` (no route; BE-5 schedules it). `PENDING` uploads older than 24 h and, as DT-145
 * decides, soft-deleted unreferenced files older than 24 h, in three steps per file:
 * 1. A unit of work locks the row `FOR UPDATE`, rechecks it and soft-deletes it. A file confirmed or
 *    attached since the scan fails the recheck and keeps its asset; once deleted, a confirm or an attach
 *    no longer finds it, so no `READY` row or reference can point at a destroyed asset (C23, DT-147).
 * 2. The asset is destroyed outside any transaction (idempotent).
 * 3. A second unit of work deletes the row with one `SYSTEM_JOB` entry.
 * A failure leaves a soft-deleted, unreferenced row that a later run takes again under DT-145, and never
 * aborts this run.
 */
export class CleanupFiles {
  constructor(
    private readonly files: FileCleanupRepository,
    private readonly storage: FileStoragePort,
    private readonly activity: ActivityLogPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clock: ClockPort,
    private readonly onFailure: CleanupFailureReporter,
  ) {}

  async execute(actor: Actor): Promise<CleanupFilesResult> {
    if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
    const cutoff = new Date(this.clock.now().getTime() - CLEANUP_MIN_AGE_MS);
    const candidates = await this.files.findCleanupCandidates(cutoff, CLEANUP_BATCH_SIZE);

    let deleted = 0;
    let skipped = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const reason = await this.uow.run(async () => {
          const file = await this.files.lockForCleanup(candidate.id);
          if (!file) return null;
          const referenced = await this.files.isReferenced(file.id);
          if (!isCleanupEligible(file, referenced, cutoff)) return null;
          if (file.deletedAt !== null) return 'DELETED';
          await this.files.softDelete(file.id, this.clock.now());
          return 'PENDING_EXPIRED';
        });
        if (reason === null) {
          skipped += 1;
          continue;
        }
        await this.storage.destroy(candidate.storageKey);
        const removed = await this.uow.run(async () => {
          const file = await this.files.lockForCleanup(candidate.id);
          if (!file || (await this.files.isReferenced(file.id))) return false;
          if (!(await this.files.hardDelete(file.id))) return false;
          await this.activity.record({
            actor,
            action: 'SYSTEM_JOB',
            entityType: 'FILE',
            entityId: file.id,
            entityLabel: file.originalName,
            metadata: { reason },
          });
          return true;
        });
        if (removed) deleted += 1;
        else skipped += 1;
      } catch (error) {
        failed += 1;
        this.onFailure(error, { fileId: candidate.id, storageKey: candidate.storageKey });
      }
    }
    return { deleted, skipped, failed };
  }
}
