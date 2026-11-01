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

/** New texts of one entry; an omitted field is left alone, `null` clears it. */
export interface SearchTextsUpdate {
  readonly entityId: string;
  readonly subtitle?: string | null;
  readonly body?: string | null;
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
  /**
   * Set-based relabel of `subtitle` and `body` (same cleaning and body cap as `upsert`), only where the
   * value differs, so an unchanged entry keeps its `updatedAt`. A missing entry is a no-op.
   * Returns the rows changed.
   */
  setTexts(entityType: EntityType, rows: readonly SearchTextsUpdate[]): Promise<number>;
}
