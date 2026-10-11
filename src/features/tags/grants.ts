import type { PermissionAction, PermissionResource } from "@/server/auth/permissions";

/**
 * The grants that let a user create a tag (any one of them): `createTagAction` checks them on submit (C13) and
 * `canCreateTagsInline()` uses the same list to show or hide the inline "Crear". Not in `actions.ts` because a
 * `"use server"` file may only export async functions.
 */
export const CREATE_TAG_GRANTS = [
  { action: "create", resource: "settings" },
  { action: "update", resource: "client" },
  { action: "update", resource: "project" },
  { action: "create", resource: "note" },
  { action: "create", resource: "document" },
] as const satisfies readonly { action: PermissionAction; resource: PermissionResource }[];
