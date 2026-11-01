import type {
  CleanupCandidate,
  FileCleanupRepository,
} from '../../src/modules/platform/application/ports/file.repository.port';
import type { StoredFile } from '../../src/modules/platform/domain/file';

/** Fake `FileCleanupRepository`: sees deleted rows, like the Prisma adapter. */
export class InMemoryFileCleanupRepository implements FileCleanupRepository {
  readonly rows = new Map<string, StoredFile>();
  readonly referenced = new Set<string>();
  readonly locked: string[] = [];

  add(file: StoredFile): void {
    this.rows.set(file.id, file);
  }

  findCleanupCandidates(cutoff: Date, limit: number): Promise<CleanupCandidate[]> {
    const due = [...this.rows.values()]
      .filter((f) => !this.referenced.has(f.id))
      .filter((f) =>
        f.deletedAt !== null
          ? f.deletedAt < cutoff
          : f.status === 'PENDING' && f.createdAt < cutoff,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit);
    return Promise.resolve(due.map((f) => ({ id: f.id, storageKey: f.storageKey })));
  }

  lockForCleanup(id: string): Promise<StoredFile | null> {
    this.locked.push(id);
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  isReferenced(id: string): Promise<boolean> {
    return Promise.resolve(this.referenced.has(id));
  }

  hardDelete(id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }
}
