import { can, type PermissionSubject } from "@/server/auth/permissions";

/**
 * What the payment screens may show (PRD §4.3, resource `payment`, the finance rows). The pages answer the
 * not-found page when a role cannot read payments, and hide the entry points when it cannot create one. The
 * services and actions check again: this is the cosmetic half.
 */
export function paymentScreenPermissions(user: PermissionSubject) {
  return {
    canRead: can(user, "read", "payment"),
    canCreate: can(user, "create", "payment"),
  };
}
