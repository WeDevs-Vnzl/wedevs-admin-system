import type { UserDetailOutput, UserListRowOutput } from '../../application/models';
import type { Invitation } from '../../application/ports/identity-provider.port';

export function toUserDetailDto(user: UserDetailOutput) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    role: user.role,
    locale: user.locale,
    theme: user.theme,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function toUserListRowDto(user: UserListRowOutput) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toInvitationDto(invitation: Invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    createdAt: invitation.createdAt.toISOString(),
  };
}
