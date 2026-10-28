import type { UserRole } from '../../../../shared/domain/enums';

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

/** A pending invitation held by the identity provider (Clerk). No provider type crosses the port. */
export interface Invitation {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly createdAt: Date;
}

export interface VerifiedSession {
  readonly clerkId: string;
}

/** The external identity provider behind a port (Clerk in production). */
export interface IdentityProviderPort {
  /** `null` = invalid, expired, wrong audience/party or wrongly signed token. Never throws for those. */
  verifySessionToken(token: string): Promise<VerifiedSession | null>;
  /** Throws `ConflictError` (field `email`) when the e-mail already has an invitation or an account. */
  createInvitation(email: string, role: UserRole): Promise<Invitation>;
  /** Up to 100 pending invitations, newest first. */
  listPendingInvitations(): Promise<Invitation[]>;
  /** Revokes a pending invitation and returns it. Throws `NotFoundError` when there is none. */
  revokeInvitation(id: string): Promise<Invitation>;
  /** Mirrors the local role into the provider's public metadata (informational, best effort). */
  setRoleMetadata(clerkId: string, role: UserRole): Promise<void>;
}
