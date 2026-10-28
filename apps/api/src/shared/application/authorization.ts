/**
 * Vocabulary of the permission matrix (PRD §4.3, DT-66). The matrix itself and `can()` live in the
 * `AuthorizationPort` adapter (package 2.1); this file only names what can be asked.
 */

export const PERMISSION_ACTION_VALUES = ['create', 'read', 'update', 'delete', 'restore'] as const;
/**
 * `create` = C, `read` = R, `update` = U, `delete` = D (always a soft delete / archive, C20) and
 * `restore` = take a record out of the trash.
 */
export type PermissionAction = (typeof PERMISSION_ACTION_VALUES)[number];

/** One resource per area of the matrix; resources sharing a PRD row share its grants. */
export const PERMISSION_RESOURCE_VALUES = [
  'client',
  'contact',
  'project',
  'billing',
  'invoice',
  'payment',
  'account',
  'expense',
  'document',
  'share',
  'note',
  'report',
  'activity',
  'settings',
  'user',
  'trash',
] as const;
export type PermissionResource = (typeof PERMISSION_RESOURCE_VALUES)[number];

export interface PermissionOptions {
  /** Id of the user who owns the record (e.g. the author of a note), for "own records only" grants. */
  readonly ownerId?: string | null;
}
