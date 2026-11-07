import { z } from "./zod";
import { idSchema, listQuerySchema } from "./common";
import { userRoleSchema } from "./enums";
import { localeSchema, themeSchema } from "./preferences";
import { facetOf, requiredText, timestampSchema, withSortFields } from "./tags";

/**
 * Users and roles (PRD §4, §8.15 "Usuarios"; Owner only). Users are provisioned through Clerk
 * invitations (a webhook mirrors them into the local `User` table, whose `role` is the source of truth —
 * C13). Pending invitations are listed next to the users, with `status: "INVITED"`.
 */

export const USER_STATUS_VALUES = ["ACTIVE", "INVITED"] as const;
export const userStatusSchema = z.enum(USER_STATUS_VALUES);
export type UserStatus = z.infer<typeof userStatusSchema>;

// ───────────────────────────── Inputs ─────────────────────────────

/** `inviteUser`: invitation by e-mail with the role the person will get. New users default to Admin. */
export const inviteUserInputSchema = z.object({
  email: z.email().max(254),
  role: userRoleSchema.default("ADMIN"),
});
export type InviteUserInput = z.infer<typeof inviteUserInputSchema>;

/** `changeUserRole`. The last Owner cannot be demoted (INTEGRITY_LOCK, enforced by the service). */
export const changeUserRoleInputSchema = z.object({
  userId: idSchema,
  role: userRoleSchema,
});
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleInputSchema>;

/** `revokeUserInvitation`: cancels a pending invitation. */
export const revokeUserInvitationInputSchema = z.object({ invitationId: idSchema });
export type RevokeUserInvitationInput = z.infer<typeof revokeUserInvitationInputSchema>;

export const userIdInputSchema = z.object({ id: idSchema });
export type UserIdInput = z.infer<typeof userIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const USER_SORT_FIELDS = ["name", "email", "role", "createdAt"] as const;

export const userFilterSchema = withSortFields(
  listQuerySchema.extend({
    role: facetOf(userRoleSchema),
    status: facetOf(userStatusSchema),
  }),
  USER_SORT_FIELDS,
);
export type UserFilter = z.infer<typeof userFilterSchema>;
export type UserFilterInput = z.input<typeof userFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Who did something (author, uploader, actor): enough for an avatar and a name. */
export const userRefSchema = z.object({
  id: idSchema,
  name: requiredText(120),
  imageUrl: z.string().nullable(),
});
/** Row of Settings → Usuarios. An `INVITED` row is a pending invitation (`id` = the invitation id). */
export const userListRowSchema = z.object({
  id: idSchema,
  name: z.string().nullable(),
  email: z.email(),
  imageUrl: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  /** Invitation date for `INVITED`, account creation for `ACTIVE`. */
  createdAt: timestampSchema,
});
export type UserListRowDTO = z.infer<typeof userListRowSchema>;

export const userDetailSchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.email(),
  imageUrl: z.string().nullable(),
  role: userRoleSchema,
  locale: localeSchema,
  theme: themeSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type UserDetailDTO = z.infer<typeof userDetailSchema>;
