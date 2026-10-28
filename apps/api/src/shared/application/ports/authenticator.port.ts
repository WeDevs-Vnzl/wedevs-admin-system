import type { CurrentUser } from '../current-user';

/** Turns a bearer token into the local active user. */
export interface AuthenticatorPort {
  /** `null` = invalid or expired token, or no active local `User` for it. Never throws for those cases. */
  authenticate(bearerToken: string): Promise<CurrentUser | null>;
}
