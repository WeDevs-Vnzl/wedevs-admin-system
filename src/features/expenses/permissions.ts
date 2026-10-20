import { can, type PermissionSubject } from "@/server/auth/permissions";

/**
 * What the expense screens may show (PRD §4.3, resource `expense`, Owner and Admin). The pages answer the
 * not-found page when a role cannot read the module, and hide the write entry points when it cannot create or
 * update. The services and actions check again: this is the cosmetic half.
 */
export function expenseScreenPermissions(user: PermissionSubject) {
  return {
    canRead: can(user, "read", "expense"),
    canCreate: can(user, "create", "expense"),
    canUpdate: can(user, "update", "expense"),
  };
}
