import type { FileRepository } from '../../src/modules/platform/application/ports/file.repository.port';
import type { StoredFile } from '../../src/modules/platform/domain/file';

/** Fake `FileRepository` with soft-delete semantics: reads never return deleted rows. */
export class InMemoryFileRepository implements FileRepository {
  readonly rows = new Map<string, StoredFile>();
  /** Ids a business row "references" (invoice, payment, ...), as the Prisma relations would. */
  readonly referenced = new Set<string>();

  insert(file: StoredFile): Promise<void> {
    this.rows.set(file.id, file);
    return Promise.resolve();
  }

  findById(id: string): Promise<StoredFile | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.deletedAt === null ? row : null);
  }

  /** Ids passed to `lockForUpdate`, in call order (the fake has no real locks). */
  readonly locked: string[] = [];

  lockForUpdate(id: string): Promise<StoredFile | null> {
    this.locked.push(id);
    return this.findById(id);
  }

  markReady(id: string, verified: { sizeBytes: number; mimeType: string }): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.deletedAt !== null || row.status !== 'PENDING') return Promise.resolve(false);
    this.rows.set(id, { ...row, ...verified, status: 'READY' });
    return Promise.resolve(true);
  }

  softDelete(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.deletedAt !== null) return Promise.resolve(false);
    this.rows.set(id, { ...row, deletedAt: at });
    return Promise.resolve(true);
  }

  isReferenced(id: string): Promise<boolean> {
    return Promise.resolve(this.referenced.has(id));
  }
}
