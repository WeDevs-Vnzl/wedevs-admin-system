import type { EntityType } from '../../domain/enums';

/** One `SearchEntry` row (PRD §10.3): the plain-text projection of an indexable entity. */
export interface SearchIndexEntry {
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly code: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  /** Plain text (no markup); the adapter truncates it to its documented cap. */
  readonly body: string | null;
  readonly status: string | null;
  readonly archived: boolean;
}

/**
 * Write side of the global search index (C12). Valid only inside `UnitOfWorkPort.run`: called outside
 * one it is a programming error and throws, like `ActivityLogPort`.
 */
export interface SearchIndexPort {
  /** Inserts or replaces the entry of `(entityType, entityId)`; idempotent. */
  upsert(entry: SearchIndexEntry): Promise<void>;
  /** Flips the archived flag; a missing entry is a no-op. */
  setArchived(entityType: EntityType, entityId: string, archived: boolean): Promise<void>;
}
