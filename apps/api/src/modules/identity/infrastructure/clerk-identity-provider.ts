import {
  createClerkClient,
  verifyToken,
  type ClerkClient,
  type Invitation as ClerkInvitation,
} from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import type {
  IdentityProviderPort,
  Invitation,
  VerifiedSession,
} from '../application/ports/identity-provider.port';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../../shared/domain/domain-error';
import type { UserRole } from '../../../shared/domain/enums';
import { USER_ERROR_KEYS, parseUserRole } from '../domain/user';

export interface ClerkIdentityConfig {
  /** Clerk secret key (Backend API). Never logged (C5). */
  readonly secretKey: string;
  /** PEM public key of the instance: tokens are verified networkless with it. */
  readonly jwtKey: string;
  /** `APP_URL`: the only authorized party of a session token and the invitation redirect. */
  readonly appUrl: string;
  /** Overrides the Backend API base URL (tests). */
  readonly apiUrl?: string;
}

const MAX_PENDING_INVITATIONS = 100;
const DUPLICATE_CODES = new Set(['duplicate_record', 'form_identifier_exists']);

type Operation = 'create' | 'list' | 'revoke' | 'metadata';

/** Clerk adapter of the identity port: no Clerk type crosses it and no error carries a key. */
export class ClerkIdentityProvider implements IdentityProviderPort {
  private readonly clerk: ClerkClient;
  private readonly authorizedParties: string[];

  constructor(private readonly config: ClerkIdentityConfig) {
    this.clerk = createClerkClient({
      secretKey: config.secretKey,
      ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
    });
    this.authorizedParties = [new URL(config.appUrl).origin];
  }

  async verifySessionToken(token: string): Promise<VerifiedSession | null> {
    try {
      const claims = await verifyToken(token, {
        jwtKey: this.config.jwtKey,
        authorizedParties: this.authorizedParties,
      });
      return typeof claims.sub === 'string' && claims.sub.length > 0
        ? { clerkId: claims.sub }
        : null;
    } catch {
      // Expired, not yet valid, wrong party, wrong signature or malformed: all the same to the caller.
      return null;
    }
  }

  async createInvitation(email: string, role: UserRole): Promise<Invitation> {
    try {
      const created = await this.clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { role },
        redirectUrl: this.config.appUrl,
        ignoreExisting: false,
      });
      return toInvitation(created);
    } catch (error) {
      throw this.translate(error, 'create');
    }
  }

  async listPendingInvitations(): Promise<Invitation[]> {
    try {
      const page = await this.clerk.invitations.getInvitationList({
        status: 'pending',
        limit: MAX_PENDING_INVITATIONS,
      });
      return page.data.map(toInvitation);
    } catch (error) {
      throw this.translate(error, 'list');
    }
  }

  async revokeInvitation(id: string): Promise<Invitation> {
    try {
      return toInvitation(await this.clerk.invitations.revokeInvitation(id));
    } catch (error) {
      throw this.translate(error, 'revoke');
    }
  }

  async setRoleMetadata(clerkId: string, role: UserRole): Promise<void> {
    try {
      await this.clerk.users.updateUserMetadata(clerkId, { publicMetadata: { role } });
    } catch (error) {
      throw this.translate(error, 'metadata');
    }
  }

  /** Clerk failures become domain errors; anything else is an opaque failure with no payload (C5). */
  private translate(error: unknown, operation: Operation): Error {
    if (!isClerkAPIResponseError(error)) {
      return new Error(`Identity provider request failed (${operation})`);
    }
    const codes = error.errors.map((item) => item.code);
    if (operation === 'create') {
      if (error.status === 409 || codes.some((code) => DUPLICATE_CODES.has(code))) {
        return new ConflictError({ fieldErrors: { email: [USER_ERROR_KEYS.emailTaken] } });
      }
      if (error.status === 422 || error.status === 400) {
        return new ValidationFailedError({ fieldErrors: { email: ['validation.invalidEmail'] } });
      }
    }
    // A missing or no longer pending invitation: 404, or a 4xx about its state.
    if (operation === 'revoke' && [400, 404, 422].includes(error.status))
      return new NotFoundError();
    if (error.status === 404) return new NotFoundError();
    return new Error(`Identity provider request failed (${operation}, status ${error.status})`);
  }
}

function toInvitation(invitation: ClerkInvitation): Invitation {
  return {
    id: invitation.id,
    email: invitation.emailAddress,
    role: parseUserRole(invitation.publicMetadata?.role) ?? 'VIEWER',
    createdAt: new Date(invitation.createdAt),
  };
}
