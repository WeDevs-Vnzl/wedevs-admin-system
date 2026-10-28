import type {
  IdentityProviderPort,
  Invitation,
  VerifiedSession,
} from '../../../src/modules/identity/application/ports/identity-provider.port';
import { ConflictError, NotFoundError } from '../../../src/shared/domain/domain-error';
import type { UserRole } from '../../../src/shared/domain/enums';

/** In-memory identity provider: `issue(clerkId)` mints a token that `verifySessionToken` resolves. */
export class FakeIdentityProvider implements IdentityProviderPort {
  private readonly sessions = new Map<string, string>();
  private counter = 0;
  readonly invitations = new Map<string, Invitation>();
  readonly roleMetadata = new Map<string, UserRole>();
  /** Failure injection. */
  failSetRoleMetadata = false;
  failRevoke = false;

  issue(clerkId: string): string {
    const token = `fake-clerk-token-${++this.counter}`;
    this.sessions.set(token, clerkId);
    return token;
  }

  verifySessionToken(token: string): Promise<VerifiedSession | null> {
    const clerkId = this.sessions.get(token);
    return Promise.resolve(clerkId ? { clerkId } : null);
  }

  createInvitation(email: string, role: UserRole): Promise<Invitation> {
    for (const existing of this.invitations.values()) {
      if (existing.email === email) {
        return Promise.reject(
          new ConflictError({ fieldErrors: { email: ['settings.users.errors.emailTaken'] } }),
        );
      }
    }
    const invitation: Invitation = {
      id: `inv_${this.invitations.size + 1}`,
      email,
      role,
      createdAt: new Date('2026-01-15T12:00:00.000Z'),
    };
    this.invitations.set(invitation.id, invitation);
    return Promise.resolve(invitation);
  }

  listPendingInvitations(): Promise<Invitation[]> {
    return Promise.resolve([...this.invitations.values()]);
  }

  revokeInvitation(id: string): Promise<Invitation> {
    if (this.failRevoke) return Promise.reject(new Error('revoke failed'));
    const invitation = this.invitations.get(id);
    if (!invitation) return Promise.reject(new NotFoundError());
    this.invitations.delete(id);
    return Promise.resolve(invitation);
  }

  setRoleMetadata(clerkId: string, role: UserRole): Promise<void> {
    if (this.failSetRoleMetadata) return Promise.reject(new Error('clerk down'));
    this.roleMetadata.set(clerkId, role);
    return Promise.resolve();
  }
}
