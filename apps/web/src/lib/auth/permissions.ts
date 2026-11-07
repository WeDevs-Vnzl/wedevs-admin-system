import type { UserRole } from "@/lib/validators/enums";
import type { SessionUser } from "./types";

/**
 * The permission matrix of PRD §4.3 and the central `can()` (C13, DT-40).
 *
 * Pure and framework-free: no `next/*`, `react`, `next-intl` or `@clerk/*`, no I/O. Server Actions call
 * it before anything else; hiding a button in the UI is cosmetic, this is the rule. Anything not granted
 * here is denied.
 */

export const PERMISSION_ACTION_VALUES = ["create", "read", "update", "delete", "restore"] as const;
/**
 * Action vocabulary (DT-66). The PRD names no actions; these map its C/R/U/D letters:
 * `create` = C · `read` = R · `update` = U · `delete` = D, always a soft delete / archive (C20) ·
 * `restore` = take a record out of the trash (governed by the trash row, see `can`).
 */
export type PermissionAction = (typeof PERMISSION_ACTION_VALUES)[number];

/**
 * One resource per area of the matrix (finer than the PRD rows so adapters can name what they touch,
 * DT-66). Resources that share a PRD row share its grants below.
 */
export const PERMISSION_RESOURCE_VALUES = [
  "client", // PRD row "Clientes y contactos"
  "contact", //   "
  "project", // "Proyectos"
  "billing", // "Esquema de cobro"
  "invoice", // "Facturas, pagos, cuentas y gastos"
  "payment", //   "
  "account", //   "
  "expense", //   "
  "document", // "Documentos"
  "share", // "Compartir en el portal"
  "note", // "Notas"
  "report", // "Reportes y KPI"
  "activity", // "Registro de actividad"
  "settings", // "Configuración y catálogos"
  "user", // "Usuarios y roles"
  "trash", // "Papelera (restaurar)"
] as const;
export type PermissionResource = (typeof PERMISSION_RESOURCE_VALUES)[number];

/** Minimum a user must expose to be authorized. */
export type PermissionSubject = Pick<SessionUser, "id" | "role">;

export interface PermissionOptions {
  /** Id of the user who owns the record (e.g. the author of a note). Needed for "own records only" grants. */
  ownerId?: string | null;
}

interface RoleGrant {
  actions: readonly PermissionAction[];
  /** Actions granted only on records the user owns (`opts.ownerId === user.id`). */
  ownOnly?: readonly PermissionAction[];
}

const NONE: RoleGrant = { actions: [] };
const grant = (...actions: PermissionAction[]): RoleGrant => ({ actions });

const CRUD = grant("create", "read", "update", "delete"); // CRUD, and "✓" on the non-CRUD rows
const READ = grant("read"); // R
const RU = grant("read", "update"); // RU
const CRU = grant("create", "read", "update"); // CRU
const NOTES_MEMBER: RoleGrant = {
  actions: ["create", "read", "update"],
  ownOnly: ["delete"], // CRUD, D only on their own notes
};
const TRASH = grant("read", "restore");

type RoleGrants = Record<UserRole, RoleGrant>;
const row = (owner: RoleGrant, admin: RoleGrant, member: RoleGrant, viewer: RoleGrant) =>
  ({ OWNER: owner, ADMIN: admin, MEMBER: member, VIEWER: viewer }) satisfies RoleGrants;

const FINANCE = row(CRUD, CRUD, NONE, NONE);
const OWNER_ADMIN_ONLY = row(CRUD, CRUD, NONE, NONE);

/** PRD §4.3, one entry per resource. */
export const PERMISSION_MATRIX: Readonly<Record<PermissionResource, Readonly<RoleGrants>>> = {
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
  // Read-only for Owner and Admin (DT-66): the log is append-only (C20) and written only by services
  // through `logActivity`, never through a `can()` grant.
  activity: row(READ, READ, NONE, NONE),
  settings: OWNER_ADMIN_ONLY,
  user: row(CRUD, NONE, NONE, NONE),
  trash: row(TRASH, TRASH, NONE, NONE),
};

function isAllowed(
  role: UserRole,
  userId: string,
  action: PermissionAction,
  resource: PermissionResource,
  opts: PermissionOptions,
): boolean {
  const roleGrant = PERMISSION_MATRIX[resource]?.[role];
  if (!roleGrant) return false;
  if (roleGrant.actions.includes(action)) return true;
  if (roleGrant.ownOnly?.includes(action)) {
    return typeof opts.ownerId === "string" && opts.ownerId.length > 0 && opts.ownerId === userId;
  }
  return false;
}

/**
 * Whether `user` may perform `action` on `resource`.
 *
 * - No user (unauthenticated), an unknown role, action or resource → `false`.
 * - `restore` on any resource is governed by the trash row (Owner and Admin only) and additionally needs
 *   `read` and `delete` on that resource: nobody restores what they cannot see, and only soft-deletable
 *   records are restorable (so never `activity`, which is append-only, DT-66).
 * - Grants that are "own records only" (Member `D` on notes) need `opts.ownerId === user.id`; without an
 *   `ownerId` they are denied.
 */
export function can(
  user: PermissionSubject | null | undefined,
  action: PermissionAction,
  resource: PermissionResource,
  opts: PermissionOptions = {},
): boolean {
  if (!user) return false;
  if (action === "restore" && resource !== "trash") {
    return (
      isAllowed(user.role, user.id, "restore", "trash", opts) &&
      isAllowed(user.role, user.id, "read", resource, opts) &&
      isAllowed(user.role, user.id, "delete", resource, opts)
    );
  }
  return isAllowed(user.role, user.id, action, resource, opts);
}

/**
 * Financial visibility (PRD §11): Owner and Admin see money everywhere; Member and Viewer get the
 * dashboard and detail pages without financial data.
 */
export function canSeeFinancials(user: PermissionSubject | null | undefined): boolean {
  return can(user, "read", "invoice");
}
