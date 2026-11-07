"use server";

import { apiAction } from "@/lib/api/action";
import {
  type ChangeUserRoleInput,
  type InviteUserInput,
  type RevokeUserInvitationInput,
  type UserFilterInput,
} from "@/lib/validators/users";
import { listUsersWithInvitations } from "./list-users";

const SETTINGS_USERS_PATH = "/settings/users";

// Settings → Usuarios (PRD §8.15, HU-02): thin proxies to the API. The BE `can()` decides (Owner only, HU-02
// CA2); a `FORBIDDEN` reaches the UI as a result and nothing changes.

export const listUsersAction = apiAction({
  call: (input: UserFilterInput, api) => listUsersWithInvitations(api, input),
});

/** Invitation by e-mail with a role. A taken e-mail is `CONFLICT` on `email`. */
export const inviteUserAction = apiAction({
  call: (input: InviteUserInput, api) => api.POST("/api/v1/users/invitations", { body: input }),
  revalidate: [SETTINGS_USERS_PATH],
});

/** Changes a role; the last Owner cannot be demoted (`INTEGRITY_LOCK`). */
export const changeUserRoleAction = apiAction({
  call: ({ userId, role }: ChangeUserRoleInput, api) =>
    api.PATCH("/api/v1/users/{id}", { params: { path: { id: userId } }, body: { role } }),
  revalidate: [SETTINGS_USERS_PATH],
});

export const revokeUserInvitationAction = apiAction({
  call: ({ invitationId }: RevokeUserInvitationInput, api) =>
    api.POST("/api/v1/users/invitations/{id}/revoke", { params: { path: { id: invitationId } } }),
  revalidate: [SETTINGS_USERS_PATH],
});
