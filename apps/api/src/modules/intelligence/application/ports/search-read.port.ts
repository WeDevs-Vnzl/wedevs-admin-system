import type { EntityType } from '../../../../shared/domain/enums';
import type { SearchIndexEntry } from '../../../../shared/application/ports/search-index.port';
import type { SearchableEntityType } from '../../domain/search-query';

export const SEARCH_READ = Symbol('SEARCH_READ');
export const SEARCH_INDEX_MAINTENANCE = Symbol('SEARCH_INDEX_MAINTENANCE');

/** One hit: what the palette shows (PRD §7.6). */
export interface SearchHit {
  readonly entityType: SearchableEntityType;
  readonly entityId: string;
  readonly code: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  readonly status: string | null;
  readonly archived: boolean;
}

export interface SearchCriteria {
  /** The text to search, already stripped of its prefix; never blank. */
  readonly text: string;
  /** Types the caller may read and asked for; never empty. */
  readonly types: readonly SearchableEntityType[];
  readonly includeArchived: boolean;
}

export interface SearchRankedResult {
  /** Best first, at most `limit` in total. */
  readonly hits: readonly SearchHit[];
  /** Matches of each type before the cap; a type without matches is absent. */
  readonly totals: Readonly<Partial<Record<SearchableEntityType, number>>>;
}

/** Read side of the global search over `SearchEntry` (tsvector plus trigram, A10). */
export interface SearchReadPort {
  /** The record whose code (or, for an invoice, fiscal number) equals `text`, if any (HU-26 CA3). */
  findExact(criteria: SearchCriteria): Promise<SearchHit | null>;
  /** Ranked matches: `tsvector` prefix match or `word_similarity` against the title. */
  search(criteria: SearchCriteria, limit: number): Promise<SearchRankedResult>;
}

/** How a source's entry compares with what is stored, after the index's own normalization. */
export type EntryComparison = 'missing' | 'same' | 'different';

/**
 * What `ReindexAll` needs beyond `SearchIndexPort` (which has no delete and cannot see orphans). Reads
 * work inside or outside a unit of work; `remove` requires one.
 */
export interface SearchIndexMaintenancePort {
  /** Compares `entry` with the stored row after `clean` and the body cap, so a capped body is not churn. */
  compare(entry: SearchIndexEntry): Promise<EntryComparison>;
  /** Ids of the indexed entries of a type, ascending, strictly after `afterId`. */
  listEntityIds(entityType: EntityType, afterId: string | null, take: number): Promise<string[]>;
  /** Deletes the entry; true when one existed. */
  remove(entityType: EntityType, entityId: string): Promise<boolean>;
}
