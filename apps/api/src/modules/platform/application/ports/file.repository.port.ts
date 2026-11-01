import type { StoredFile } from '../../domain/file';

export const FILE_REPOSITORY = Symbol('FILE_REPOSITORY');

/** `File` persistence. Every read excludes soft-deleted rows (PRD §7.7). */
export interface FileRepository {
  insert(file: StoredFile): Promise<void>;
  findById(id: string): Promise<StoredFile | null>;
  /**
   * `SELECT ... FOR UPDATE` on the file row, then the current (committed) row. Only valid inside a unit
   * of work; a concurrent holder makes this wait until it commits or rolls back. `null` when the file is
   * unknown or deleted. Attach and delete both take it before their checks so they serialize (C23).
   */
  lockForUpdate(id: string): Promise<StoredFile | null>;
  /** `PENDING` -> `READY` with the verified size and type. `false` when it was no longer pending. */
  markReady(id: string, verified: { sizeBytes: number; mimeType: string }): Promise<boolean>;
  /** Sets `deletedAt`. `false` when the row was already deleted or does not exist. */
  softDelete(id: string, at: Date): Promise<boolean>;
  /** Whether a business row (invoice, payment, expense, document version, note) points at the file. */
  isReferenced(id: string): Promise<boolean>;
}

export const FILE_CLEANUP_REPOSITORY = Symbol('FILE_CLEANUP_REPOSITORY');

/** A file the cleanup step may remove; the asset is destroyed before the row (DT-145). */
export interface CleanupCandidate {
  readonly id: string;
  readonly storageKey: string;
}

/**
 * The reads and the hard delete of the `CleanupFiles` step. Unlike `FileRepository` it sees soft-deleted
 * rows, because those are exactly what it removes (DT-145, the stated exception to "no purge").
 */
export interface FileCleanupRepository {
  /**
   * Oldest first, at most `limit`: unreferenced files that are `PENDING` and created before `cutoff`, or
   * soft-deleted before `cutoff`. A plain read, so the step rechecks each file under its lock.
   */
  findCleanupCandidates(cutoff: Date, limit: number): Promise<CleanupCandidate[]>;
  /**
   * `SELECT ... FOR UPDATE` on the file row, deleted or not, then the committed row. Only valid inside a
   * unit of work; it takes the lock `ReserveFileForAttachment` and `DeleteFile` take. `null` when unknown.
   */
  lockForCleanup(id: string): Promise<StoredFile | null>;
  /** Whether a business row points at the file (deleted rows included). */
  isReferenced(id: string): Promise<boolean>;
  /** Removes the row. `false` when it no longer exists. Only valid inside a unit of work. */
  hardDelete(id: string): Promise<boolean>;
}
