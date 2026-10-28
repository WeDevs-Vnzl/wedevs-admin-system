import type { UserRole } from '../../../shared/domain/enums';
import type { UserRecord } from '../domain/user';

/** Detail of a user (`GET /me`, `GET /users/{id}`). The Clerk id never leaves the BE. */
export interface UserDetailOutput {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly imageUrl: string | null;
  readonly role: UserRole;
  readonly locale: string;
  readonly theme: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Row of the users list. */
export interface UserListRowOutput {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly imageUrl: string | null;
  readonly role: UserRole;
  readonly createdAt: Date;
}

export function toUserDetail(user: UserRecord): UserDetailOutput {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    role: user.role,
    locale: user.locale,
    theme: user.theme,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toUserListRow(user: UserRecord): UserListRowOutput {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    role: user.role,
    createdAt: user.createdAt,
  };
}
