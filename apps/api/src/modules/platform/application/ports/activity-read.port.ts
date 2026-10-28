import type { ActivityAction, ActorType, EntityType } from '../../../../shared/domain/enums';
import type { SortDirection } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';

export const ACTIVITY_READ = Symbol('ACTIVITY_READ');

export type ActivitySortField = 'createdAt' | 'action' | 'entityType';

export interface ActivitySort {
  readonly field: ActivitySortField;
  readonly direction: SortDirection;
}

/** One `changes` value: `[before, after]`, or the `"changed"` marker of a long text (C20). */
export type ActivityChangeValue = string | boolean | null;
export type ActivityChange = [ActivityChangeValue, ActivityChangeValue] | 'changed';
export type ActivityChanges = Record<string, ActivityChange>;
export type ActivityMetadata = Record<string, string | number | boolean | null>;

/**
 * Everything the read needs, already validated by the use case. `createdFrom` is inclusive and
 * `createdBefore` exclusive: the Caracas calendar days of `from`/`to` (both inclusive) as instants.
 */
export interface ActivityListCriteria {
  readonly page: number;
  readonly pageSize: number;
  readonly sort: ActivitySort;
  /** Accent-insensitive contains over the entity label and the actor's name. */
  readonly search: string | null;
  readonly actorIds: readonly string[];
  readonly actorTypes: readonly ActorType[];
  readonly actions: readonly ActivityAction[];
  readonly entityTypes: readonly EntityType[];
  readonly entityId: string | null;
  readonly createdFrom: Date | null;
  readonly createdBefore: Date | null;
}

/** A stored entry with its actor joined from `User`. The IP is raw here: masking is the use case's rule. */
export interface ActivityRecord {
  readonly id: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorImageUrl: string | null;
  readonly action: ActivityAction;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly entityLabel: string;
  readonly changes: ActivityChanges | null;
  readonly metadata: ActivityMetadata | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

/** Read-only port over `ActivityLog` (append-only, C20): there is no write method. */
export interface ActivityReadPort {
  list(criteria: ActivityListCriteria): Promise<Paginated<ActivityRecord>>;
}
