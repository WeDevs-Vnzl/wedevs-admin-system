import type { PermissionResource } from '../../../../shared/application/authorization';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import type { EntityType } from '../../../../shared/domain/enums';

export const RESTORE_HANDLER_REGISTRY = Symbol('RESTORE_HANDLER_REGISTRY');

/** Entity types that can appear in the trash (soft-deletable main entities, `data-rules.md` §6). */
export const TRASHABLE_ENTITY_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'RECURRING_EXPENSE',
  'ACCOUNT',
  'TRANSFER',
  'ACCOUNT_MOVEMENT',
  'DOCUMENT',
  'NOTE',
] as const satisfies readonly EntityType[];
export type TrashableEntityType = (typeof TRASHABLE_ENTITY_TYPE_VALUES)[number];

/**
 * What a context registers to make its archived rows restorable from the trash. `restore` runs the owning
 * context's **own** restore use case (its unit of work, conflict checks, `RESTORE` activity entry and
 * reindex); the trash never touches another context's tables to restore.
 */
export interface RestoreHandler {
  readonly entityType: TrashableEntityType;
  /** The matrix resource the actor needs `read` on to see the type and `restore` on to bring it back. */
  readonly resource: PermissionResource;
  /** Throws `NotFoundError` / `ConflictError` (with `entity`) from the owning use case. */
  restore(user: CurrentUser, entityId: string): Promise<EntityRef>;
}
