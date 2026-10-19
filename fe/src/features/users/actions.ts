"use server";

import {
  changeUserRoleInputSchema,
  inviteUserInputSchema,
  revokeUserInvitationInputSchema,
  userFilterSchema,
} from "@/lib/validators/users";
import * as users from "@/mocks/services/users";
import { defineAction } from "@/server/actions/define-action";

const SETTINGS_USERS_PATH = "/settings/users";

// Settings → Usuarios (PRD §8.15, HU-02 CA1): Owner only, through the `user` row of the matrix.

export const listUsersAction = defineAction({
  permission: { action: "read", resource: "user" },
  input: userFilterSchema,
  handler: (ctx, data) => users.listUsers(ctx, data),
});

/** Invitation by e-mail with a role (Clerk in Hito 2). A taken e-mail is `CONFLICT` on `email`. */
export const inviteUserAction = defineAction({
  permission: { action: "create", resource: "user" },
  input: inviteUserInputSchema,
  revalidate: [SETTINGS_USERS_PATH],
  handler: (ctx, data) => users.inviteUser(ctx, data),
});

/** Changes a role; the last Owner cannot be demoted (`INTEGRITY_LOCK`). */
export const changeUserRoleAction = defineAction({
  permission: { action: "update", resource: "user" },
  input: changeUserRoleInputSchema,
  revalidate: [SETTINGS_USERS_PATH],
  handler: (ctx, data) => users.changeUserRole(ctx, data),
});

export const revokeUserInvitationAction = defineAction({
  permission: { action: "delete", resource: "user" },
  input: revokeUserInvitationInputSchema,
  revalidate: [SETTINGS_USERS_PATH],
  handler: (ctx, data) => users.revokeUserInvitation(ctx, data),
});
