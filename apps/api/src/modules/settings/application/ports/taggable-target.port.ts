import type { PermissionResource } from '../../../../shared/application/authorization';
import type { TaggableEntityType } from '../../domain/tag';

export const TAGGABLE_TARGET_REGISTRY = Symbol('TAGGABLE_TARGET_REGISTRY');

/** What a context says about a record that can carry tags. */
export interface TaggableTarget {
  /** Display label of the record, for the activity entry. */
  readonly label: string;
  /** The client the record belongs to (the activity entry's `clientId`), or `null` when it has none. */
  readonly clientId: string | null;
}

/**
 * A context's answer to "is this record taggable, and who may tag it?". Each context registers one per
 * entity type it owns, from its module's `onModuleInit`; settings never reads another context's tables.
 */
export interface TaggableTargetResolver {
  readonly entityType: TaggableEntityType;
  /** The `can()` resource that governs tagging this entity type (`update` on it). */
  readonly resource: PermissionResource;
  /** `null` when the record does not exist or is archived. */
  resolve(id: string): Promise<TaggableTarget | null>;
}
