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
