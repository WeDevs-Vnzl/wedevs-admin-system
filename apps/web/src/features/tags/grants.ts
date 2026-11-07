import type { PermissionAction, PermissionResource } from "@/lib/auth/permissions";

/**
 * The grants that let a user create a tag (any one of them). They only decide whether `canCreateTagsInline()`
 * shows the inline "Crear" (cosmetic visibility); `POST /api/v1/tags` answers the real `can()` decision (C13).
 * Not in `actions.ts` because a `"use server"` file may only export async functions.
 */
export const CREATE_TAG_GRANTS = [
  { action: "create", resource: "settings" },
  { action: "update", resource: "client" },
  { action: "update", resource: "project" },
  { action: "create", resource: "note" },
  { action: "create", resource: "document" },
] as const satisfies readonly { action: PermissionAction; resource: PermissionResource }[];
