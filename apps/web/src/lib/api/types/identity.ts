import type { components } from "../schema";

// Generated response DTOs of the identity module (users, invitations, preferences, Settings), re-exported
// for code outside `src/lib/api/**` (C8). Re-exports only: no hand-written shapes.

export type UserListResponseDto = components["schemas"]["UserListResponseDto"];
export type UserListItemDto = UserListResponseDto["items"][number];
export type InvitationDto = components["schemas"]["InvitationDto"];
export type InvitationListResponseDto = components["schemas"]["InvitationListResponseDto"];
export type RevokeInvitationResponseDto = components["schemas"]["RevokeInvitationResponseDto"];
export type UserPreferencesDto = components["schemas"]["UserPreferencesDto"];
export type CompanySettingsResponseDto = components["schemas"]["CompanySettingsResponseDto"];
export type FiscalSettingsResponseDto = components["schemas"]["FiscalSettingsResponseDto"];
