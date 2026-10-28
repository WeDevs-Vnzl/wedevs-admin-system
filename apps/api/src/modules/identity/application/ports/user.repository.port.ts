import type { UserRole } from '../../../../shared/domain/enums';
import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { UserRecord } from '../../domain/user';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface NewUser {
  readonly id: string;
  readonly clerkId: string;
  readonly email: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly role: UserRole;
  readonly now: Date;
}

export interface UserProfileUpdate {
  readonly email: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly now: Date;
}

/**
 * Persistence of the local `User`. "Active" always means `deletedAt = null` (PRD §7.7); only
 * `findAnyByClerkId` sees soft-deleted rows, so the webhook never resurrects a deleted user.
 */
export interface UserRepository {
  findActiveById(id: string): Promise<UserRecord | null>;
  findActiveByClerkId(clerkId: string): Promise<UserRecord | null>;
  /** Includes soft-deleted rows. */
  findAnyByClerkId(clerkId: string): Promise<UserRecord | null>;
  /** Active user by e-mail, compared case-insensitively. */
  findActiveByEmail(email: string): Promise<UserRecord | null>;
  /** Another row (active or not) holding the e-mail: the column is unique. */
  findAnyByEmail(email: string): Promise<UserRecord | null>;
  countActiveOwners(): Promise<number>;
  list(query: ListQuery): Promise<Paginated<UserRecord>>;
  insert(user: NewUser): Promise<UserRecord>;
  /**
   * Like `insert`, but a concurrent insert of the same Clerk id (or e-mail) yields `null` instead of
   * failing, so a webhook race does not abort the unit of work.
   */
  insertIfAbsent(user: NewUser): Promise<UserRecord | null>;
  updateRole(id: string, role: UserRole, now: Date): Promise<UserRecord>;
  updateProfile(id: string, update: UserProfileUpdate): Promise<UserRecord>;
  softDelete(id: string, now: Date): Promise<void>;
}
