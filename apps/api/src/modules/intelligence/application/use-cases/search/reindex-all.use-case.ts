import type { Actor } from '../../../../../shared/application/actor';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import type { SearchReindexRegistry } from '../../../../../shared/application/ports/search-reindex.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { EntityType } from '../../../../../shared/domain/enums';
import { ConflictError } from '../../../../../shared/domain/domain-error';
import type { SearchIndexMaintenancePort } from '../../ports/search-read.port';
import { assertSystem, reindexOne, type ReindexOutcome } from './reindex-entity.use-case';

export const REINDEX_PAGE_SIZE = 200;

export interface ReindexTypeResult {
  /** Source rows walked. */
  readonly scanned: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Entries deleted because their source row is gone. */
  readonly removed: number;
  /** Ids whose unit of work lost a race (`CONFLICT`); a rename wrote them, so they are current. */
  readonly skippedIds: readonly string[];
}

export type ReindexAllResult = Readonly<Partial<Record<EntityType, ReindexTypeResult>>>;

/**
 * `ReindexAll` (DT-167): the repair of the whole index. No route, no schedule, not in `jobs`; the script
 * `scripts/reindex-all.ts` calls it as the `SYSTEM` actor. Per registered type it walks the source ids,
 * then the stored entries, and per row runs one `Serializable` unit of work (so it cannot overwrite a
 * rename); a `CONFLICT` is skipped (DT-129 pattern) and reported. Entries whose source is gone are removed.
 */
export class ReindexAll {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly registry: SearchReindexRegistry,
    private readonly index: SearchIndexPort,
    private readonly maintenance: SearchIndexMaintenancePort,
  ) {}

  async execute(actor: Actor): Promise<ReindexAllResult> {
    assertSystem(actor);
    const result: Partial<Record<EntityType, ReindexTypeResult>> = {};
    for (const entityType of this.registry.types()) {
      result[entityType] = await this.reindexType(entityType);
    }
    return result;
  }

  private async reindexType(entityType: EntityType): Promise<ReindexTypeResult> {
    const source = this.registry.get(entityType);
    const counts = { scanned: 0, created: 0, updated: 0, unchanged: 0, removed: 0 };
    const skippedIds: string[] = [];
    if (!source) return { ...counts, skippedIds };
    const seen = new Set<string>();

    const one = async (entityId: string): Promise<void> => {
      let outcome: ReindexOutcome;
      try {
        outcome = await this.uow.run(
          () => reindexOne(this.registry, this.index, this.maintenance, entityType, entityId),
          { isolation: 'Serializable' },
        );
      } catch (error) {
        if (error instanceof ConflictError) {
          skippedIds.push(entityId);
          return;
        }
        throw error;
      }
      if (outcome === 'created') counts.created += 1;
      else if (outcome === 'updated') counts.updated += 1;
      else if (outcome === 'unchanged') counts.unchanged += 1;
      else if (outcome === 'removed') counts.removed += 1;
    };

    let after: string | null = null;
    for (;;) {
      const ids: string[] = await source.pageIds(after, REINDEX_PAGE_SIZE);
      for (const id of ids) {
        seen.add(id);
        counts.scanned += 1;
        await one(id);
      }
      if (ids.length < REINDEX_PAGE_SIZE) break;
      after = ids[ids.length - 1] ?? null;
    }

    // Orphans: entries the source walk never reached. `reindexOne` re-reads the source in the unit of
    // work, so an entity created meanwhile is indexed and only a vanished one is deleted.
    let orphanAfter: string | null = null;
    for (;;) {
      const ids: string[] = await this.maintenance.listEntityIds(
        entityType,
        orphanAfter,
        REINDEX_PAGE_SIZE,
      );
      for (const id of ids) {
        if (!seen.has(id)) await one(id);
      }
      if (ids.length < REINDEX_PAGE_SIZE) break;
      orphanAfter = ids[ids.length - 1] ?? null;
    }
    return { ...counts, skippedIds };
  }
}
