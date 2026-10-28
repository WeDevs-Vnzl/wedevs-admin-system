import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { AuthenticatorPort } from '../../../src/shared/application/ports/authenticator.port';

/** Test identity adapter in place of Clerk: `issue(user)` mints an opaque bearer the fake resolves back. */
export class FakeAuthenticator implements AuthenticatorPort {
  private readonly sessions = new Map<string, CurrentUser>();
  private counter = 0;

  issue(user: CurrentUser): string {
    const token = `fake-token-${++this.counter}`;
    this.sessions.set(token, user);
    return token;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }

  authenticate(bearerToken: string): Promise<CurrentUser | null> {
    return Promise.resolve(this.sessions.get(bearerToken) ?? null);
  }
}
