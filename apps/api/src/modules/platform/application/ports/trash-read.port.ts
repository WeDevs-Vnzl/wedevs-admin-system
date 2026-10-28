import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { DateOnly } from '../../../../shared/domain/business-date';
import type { SortSpec } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { TrashableEntityType } from './restore-handler.port';

export const TRASH_READ = Symbol('TRASH_READ');

export const TRASH_SORT_FIELDS = ['deletedAt', 'entityType', 'label'] as const;
export type TrashSortField = (typeof TRASH_SORT_FIELDS)[number];

export interface TrashReadQuery {
  /** Only these types are read (already intersected with the registry and the actor's grants). */
  readonly entityTypes: readonly TrashableEntityType[];
  /** Caracas calendar days, inclusive. */
  readonly deletedFrom?: DateOnly;
  readonly deletedTo?: DateOnly;
  readonly deletedById?: readonly string[];
  /** Accent- and case-insensitive match over label, code and context. */
  readonly q?: string;
  readonly sort: SortSpec;
  readonly page: number;
  readonly pageSize: number;
}

export interface TrashUserRef {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

export interface TrashRow {
  readonly entity: EntityRef;
  /** Free context under the label (a contact's client, a project's clients, an invoice's client…). */
  readonly context: string | null;
  readonly deletedAt: Date;
  readonly deletedBy: TrashUserRef | null;
}

/**
 * Cross-context read of the archived rows (`backend-architecture.md` §3 aggregate rule): one SQL read model
 * over the tables of several contexts, never used to write.
 */
export interface TrashReadPort {
  list(query: TrashReadQuery): Promise<Paginated<TrashRow>>;
}
