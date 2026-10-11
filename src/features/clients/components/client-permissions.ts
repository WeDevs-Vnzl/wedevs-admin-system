import { can, canSeeFinancials, type PermissionSubject } from "@/server/auth/permissions";

/**
 * What the signed-in role may do on the clients screens, computed on the server and passed to the client
 * components as booleans (R13). Hiding a control is cosmetic: every action checks its own grant again (C13).
 */
export type ClientScreenPermissions = {
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  /** Owner and Admin: "Mostrar archivados" and restore (trash grant). */
  canRestore: boolean;
  canSeeFinancials: boolean;
  canReadActivity: boolean;
  canManageContacts: boolean;
  /** Inline "Crear" in the tag pickers: the same roles the tag actions accept for a clients screen. */
  canCreateTags: boolean;
};

export function clientScreenPermissions(user: PermissionSubject): ClientScreenPermissions {
  return {
    canCreate: can(user, "create", "client"),
    canUpdate: can(user, "update", "client"),
    canArchive: can(user, "delete", "client"),
    canRestore: can(user, "restore", "trash"),
    canSeeFinancials: canSeeFinancials(user),
    canReadActivity: can(user, "read", "activity"),
    canManageContacts: can(user, "update", "contact"),
    canCreateTags:
      can(user, "create", "settings") ||
      can(user, "update", "client") ||
      can(user, "create", "note") ||
      can(user, "create", "document"),
  };
}
