import type { Actor } from '../../../../../shared/application/actor';
import type { SearchIndexPort } from '../../../../../shared/application/ports/search-index.port';
import type { SearchReindexRegistry } from '../../../../../shared/application/ports/search-reindex.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import type { EntityType } from '../../../../../shared/domain/enums';
import { ForbiddenError, ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { SearchIndexMaintenancePort } from '../../ports/search-read.port';

export interface ReindexEntityInput {
  readonly entityType: EntityType;
  readonly entityId: string;
}

export interface ReindexEntityResult extends ReindexEntityInput {
  /** False when the source row is gone (its entry, if any, was removed) or the type is not indexable. */
  readonly indexed: boolean;
}

export type ReindexOutcome = 'created' | 'updated' | 'unchanged' | 'removed' | 'absent';

/** The `SYSTEM` actor is the only caller of the reindex use cases (DT-130, DT-167). */
export function assertSystem(actor: Actor): void {
  if (actor.actorType !== 'SYSTEM') throw new ForbiddenError();
}

/**
 * Rebuilds one entry from its source inside the caller's unit of work: upserts it only when it differs from
 * the stored row after the index's normalization (so `updatedAt` does not churn), removes it when its source
 * is gone. Reads the source first, so under `Serializable` a concurrent rename makes this write fail and
 * the retry read the new label.
 */
export async function reindexOne(
  registry: SearchReindexRegistry,
  index: SearchIndexPort,
  maintenance: SearchIndexMaintenancePort,
  entityType: EntityType,
  entityId: string,
): Promise<ReindexOutcome> {
  const source = registry.get(entityType);
  if (!source) {
    throw new ValidationFailedError({
      message: 'search.validation.entityType',
      fieldErrors: { entityType: ['search.validation.entityType'] },
    });
  }
  const entry = await source.entryOf(entityId);
  if (entry === null) {
    return (await maintenance.remove(entityType, entityId)) ? 'removed' : 'absent';
  }
  const state = await maintenance.compare(entry);
  if (state === 'same') return 'unchanged';
  await index.upsert(entry);
  return state === 'missing' ? 'created' : 'updated';
}

/** `ReindexEntity` (PRD §12): `SYSTEM` only; one entry, in its own `Serializable` unit of work. */
export class ReindexEntity {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly registry: SearchReindexRegistry,
    private readonly index: SearchIndexPort,
    private readonly maintenance: SearchIndexMaintenancePort,
  ) {}

  async execute(actor: Actor, input: ReindexEntityInput): Promise<ReindexEntityResult> {
    assertSystem(actor);
    if (!this.registry.get(input.entityType)) {
      return { ...input, indexed: false };
    }
    const outcome = await this.uow.run(
      () =>
        reindexOne(this.registry, this.index, this.maintenance, input.entityType, input.entityId),
      { isolation: 'Serializable' },
    );
    return { ...input, indexed: outcome !== 'removed' && outcome !== 'absent' };
  }
}
