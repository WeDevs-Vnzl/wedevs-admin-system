import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthenticatorPort } from '../../../../shared/application/ports/authenticator.port';
import type { IdentityProviderPort } from '../ports/identity-provider.port';
import type { UserRepository } from '../ports/user.repository.port';

/**
 * Turns a Clerk session token into the local active user (C13, C24). The DB row is the only source of the
 * role; a valid token whose `clerkId` has no active local `User` is not authenticated (Q-BE1-2: no
 * just-in-time provisioning, a deleted user is refused at once).
 */
export class AuthenticateRequest implements AuthenticatorPort {
  constructor(
    private readonly identity: IdentityProviderPort,
    private readonly users: UserRepository,
  ) {}

  async authenticate(bearerToken: string): Promise<CurrentUser | null> {
    const session = await this.identity.verifySessionToken(bearerToken);
    if (!session) return null;
    const user = await this.users.findActiveByClerkId(session.clerkId);
    if (!user) return null;
    return {
      userId: user.id,
      clerkId: user.clerkId,
      role: user.role,
      email: user.email,
      name: user.name,
    };
  }
}
