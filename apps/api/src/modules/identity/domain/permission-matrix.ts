import type { UserRole } from '../../../shared/domain/enums';

/**
 * The permission matrix of PRD §4.3 and the central `can()` (C13, DT-40). Pure: no I/O, no framework.
 * Anything not granted here is denied.
 *
 * The vocabulary below is the same as `shared/application/authorization.ts`; a domain file may not import
 * the application layer, so it is declared here and a unit test pins both lists to each other.
 */

export const PERMISSION_ACTION_NAMES = ['create', 'read', 'update', 'delete', 'restore'] as const;
export type PermissionActionName = (typeof PERMISSION_ACTION_NAMES)[number];

export const PERMISSION_RESOURCE_NAMES = [
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
export type PermissionResourceName = (typeof PERMISSION_RESOURCE_NAMES)[number];

/** Minimum a caller must expose to be authorized. */
export interface PermissionSubject {
  readonly userId: string;
  readonly role: UserRole;
}

export interface PermissionCheckOptions {
  /** Id of the user who owns the record (e.g. the author of a note), for "own records only" grants. */
  readonly ownerId?: string | null;
}

interface RoleGrant {
  readonly actions: readonly PermissionActionName[];
  /** Actions granted only on records the user owns (`opts.ownerId === user.userId`). */
  readonly ownOnly?: readonly PermissionActionName[];
}

const NONE: RoleGrant = { actions: [] };
const grant = (...actions: PermissionActionName[]): RoleGrant => ({ actions });

const CRUD = grant('create', 'read', 'update', 'delete'); // CRUD, and "✓" on the non-CRUD rows
const READ = grant('read');
const RU = grant('read', 'update');
const CRU = grant('create', 'read', 'update');
const NOTES_MEMBER: RoleGrant = {
  actions: ['create', 'read', 'update'],
  ownOnly: ['delete'], // CRUD, D only on their own notes
};
const TRASH = grant('read', 'restore');

export type RoleGrants = Readonly<Record<UserRole, RoleGrant>>;
const row = (
  owner: RoleGrant,
  admin: RoleGrant,
  member: RoleGrant,
  viewer: RoleGrant,
): RoleGrants => ({ OWNER: owner, ADMIN: admin, MEMBER: member, VIEWER: viewer });

const FINANCE = row(CRUD, CRUD, NONE, NONE);
const OWNER_ADMIN_ONLY = row(CRUD, CRUD, NONE, NONE);

/** PRD §4.3, one entry per resource. */
export const PERMISSION_MATRIX: Readonly<Record<PermissionResourceName, RoleGrants>> = {
  client: row(CRUD, CRUD, READ, READ),
  contact: row(CRUD, CRUD, READ, READ),
  project: row(CRUD, CRUD, RU, READ),
  billing: FINANCE,
  invoice: FINANCE,
  payment: FINANCE,
  account: FINANCE,
  expense: FINANCE,
  document: row(CRUD, CRUD, CRU, READ),
  share: OWNER_ADMIN_ONLY,
  note: row(CRUD, CRUD, NOTES_MEMBER, READ),
  report: OWNER_ADMIN_ONLY,
  // Read-only (DT-66): the log is append-only (C20), written only by use cases, never through a grant.
  activity: row(READ, READ, NONE, NONE),
  settings: OWNER_ADMIN_ONLY,
  user: row(CRUD, NONE, NONE, NONE),
  trash: row(TRASH, TRASH, NONE, NONE),
};

function isAllowed(
  subject: PermissionSubject,
  action: PermissionActionName,
  resource: PermissionResourceName,
  opts: PermissionCheckOptions,
): boolean {
  const roleGrant = Object.hasOwn(PERMISSION_MATRIX, resource)
    ? Object.hasOwn(PERMISSION_MATRIX[resource], subject.role)
      ? PERMISSION_MATRIX[resource][subject.role]
      : undefined
    : undefined;
  if (!roleGrant) return false;
  if (roleGrant.actions.includes(action)) return true;
  if (roleGrant.ownOnly?.includes(action)) {
    return (
      typeof opts.ownerId === 'string' && opts.ownerId.length > 0 && opts.ownerId === subject.userId
    );
  }
  return false;
}

/**
 * Whether `subject` may perform `action` on `resource`.
 *
 * - No subject, an unknown role, action or resource -> `false`.
 * - `restore` on any resource is governed by the trash row (Owner and Admin only) and additionally needs
 *   `read` and `delete` on that resource: nobody restores what they cannot see, and only soft-deletable
 *   records are restorable (never `activity`, which is append-only).
 * - "Own records only" grants (Member `D` on notes) need `opts.ownerId === subject.userId`.
 */
export function can(
  subject: PermissionSubject | null | undefined,
  action: PermissionActionName,
  resource: PermissionResourceName,
  opts: PermissionCheckOptions = {},
): boolean {
  if (!subject) return false;
  if (action === 'restore' && resource !== 'trash') {
    return (
      isAllowed(subject, 'restore', 'trash', opts) &&
      isAllowed(subject, 'read', resource, opts) &&
      isAllowed(subject, 'delete', resource, opts)
    );
  }
  return isAllowed(subject, action, resource, opts);
}

/**
 * Financial visibility (PRD §11): Owner and Admin see money everywhere; Member and Viewer get the dashboard
 * and detail pages without financial data.
 */
export function canSeeFinancials(subject: PermissionSubject | null | undefined): boolean {
  return can(subject, 'read', 'invoice');
}
