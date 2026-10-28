import type { UserRole } from '../domain/enums';

/**
 * The authenticated caller, resolved from the Clerk session and the local `User` row. The DB `role` is the
 * only authorization source (C13). Never built from client-supplied data.
 */
export interface CurrentUser {
  readonly userId: string;
  readonly clerkId: string;
  readonly role: UserRole;
  readonly email: string;
  readonly name: string;
}
