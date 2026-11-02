import type { CurrentUser } from '../../../shared/application/current-user';
import type { AuthenticatorPort } from '../../../shared/application/ports/authenticator.port';
import type { AuthenticateApiToken } from '../application/use-cases/api-tokens/authenticate-api-token.use-case';

/**
 * The second authenticator (DT-190): a `wdc_pat_` personal access token instead of a Clerk JWT. Bound to
 * `MCP_AUTHENTICATOR` and used only on `POST /mcp`; the Clerk `AUTHENTICATOR` is untouched.
 */
export class ApiTokenAuthenticator implements AuthenticatorPort {
  constructor(private readonly authenticateToken: AuthenticateApiToken) {}

  authenticate(bearerToken: string): Promise<CurrentUser | null> {
    return this.authenticateToken.execute(bearerToken);
  }
}
