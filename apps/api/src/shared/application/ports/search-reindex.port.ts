import type { EntityType } from '../../domain/enums';
import type { SearchIndexEntry } from './search-index.port';

/**
 * How one indexable entity type is rebuilt from its source (PRD §12 `ReindexEntity`, `ReindexAll`).
 * Each context registers its types from its module's `onModuleInit`; the search context only walks them.
 */
export interface SearchReindexSource {
  readonly entityType: EntityType;
  /** Up to `take` ids ordered ascending, strictly after `afterId` (`null` starts at the beginning); archived rows included. */
  pageIds(afterId: string | null, take: number): Promise<string[]>;
  /** The entry the source implies today, or `null` when the source row is gone (its entry is removed). */
  entryOf(id: string): Promise<SearchIndexEntry | null>;
}

/** Registry of reindex sources by entity type; `register` throws on a duplicate (like `NoteLinkTargetRegistry`). */
export class SearchReindexRegistry {
  private readonly sources = new Map<EntityType, SearchReindexSource>();

  register(source: SearchReindexSource): void {
    if (this.sources.has(source.entityType)) {
      throw new Error(`A reindex source for ${source.entityType} is already registered`);
    }
    this.sources.set(source.entityType, source);
  }

  get(entityType: EntityType): SearchReindexSource | undefined {
    return this.sources.get(entityType);
  }

  /** Registered types in registration order. */
  types(): EntityType[] {
    return [...this.sources.keys()];
  }
}
