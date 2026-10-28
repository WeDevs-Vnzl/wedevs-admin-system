import { USER_ROLE_VALUES, type UserRole } from '../../../shared/domain/enums';

/** i18n keys of the users errors (`settings.users.errors.*`). */
export const USER_ERROR_KEYS = {
  emailTaken: 'settings.users.errors.emailTaken',
  lastOwner: 'settings.users.errors.lastOwner',
} as const;

/** A local `User` row as the identity context sees it. */
export interface UserRecord {
  readonly id: string;
  readonly clerkId: string;
  readonly email: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly role: UserRole;
  readonly locale: string;
  readonly theme: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Narrows an arbitrary value to a `UserRole`; `null` when it is not one. */
export function parseUserRole(value: unknown): UserRole | null {
  return typeof value === 'string' && (USER_ROLE_VALUES as readonly string[]).includes(value)
    ? (value as UserRole)
    : null;
}

/**
 * Role of a user created by the Clerk webhook (Q-BE1-2): read from Clerk `public_metadata.role`, which only
 * the BE's own invitation or the Clerk dashboard sets. A missing or invalid value is `VIEWER` (least
 * privilege), never the schema default. After creation the local role is the only source (C13).
 */
export function resolveInitialRole(publicMetadata: unknown): UserRole {
  if (typeof publicMetadata !== 'object' || publicMetadata === null) return 'VIEWER';
  return parseUserRole((publicMetadata as Record<string, unknown>).role) ?? 'VIEWER';
}

/** E-mails are compared and stored lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Whether changing `user` to `newRole` would leave the system without an Owner. */
export function wouldRemoveLastOwner(
  user: Pick<UserRecord, 'role'>,
  newRole: UserRole,
  activeOwnerCount: number,
): boolean {
  return user.role === 'OWNER' && newRole !== 'OWNER' && activeOwnerCount <= 1;
}

/** Fields of the `UPDATE` activity diff of a user (the role is the only one an Owner changes). */
export const USER_DIFF_FIELDS = ['role'] as const;
export const USER_SYNC_DIFF_FIELDS = ['email', 'name', 'imageUrl'] as const;
