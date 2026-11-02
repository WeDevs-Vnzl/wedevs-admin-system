import type { CurrentUser } from '../../../../../shared/application/current-user';
import type { ClockPort } from '../../../../../shared/application/ports/clock.port';
import type { ApiTokenSecretsPort } from '../../ports/api-token-secrets.port';
import type { ApiTokenRepository } from '../../ports/api-token.repository.port';

export const API_TOKEN_PREFIX = 'wdc_pat_';
/** `wdc_pat_` + 43 base64url characters of 32 random bytes (A9). */
const SECRET_SHAPE = /^wdc_pat_[A-Za-z0-9_-]{43}$/;
/** `lastUsedAt` is written at most once per this interval. */
export const LAST_USED_INTERVAL_MS = 60_000;

/**
 * Resolves a presented personal access token to the local active user and its DB role (C13, DT-190).
 * The secret is hashed and looked up by digest, then the stored digest is compared in constant time.
 * Unknown, malformed, revoked, expired tokens and tokens of an archived user answer `null`; nothing here
 * logs or throws for them, and the secret is never part of an error or a log line.
 */
export class AuthenticateApiToken {
  constructor(
    private readonly tokens: ApiTokenRepository,
    private readonly secrets: ApiTokenSecretsPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(secret: string): Promise<CurrentUser | null> {
    if (typeof secret !== 'string' || !SECRET_SHAPE.test(secret)) return null;
    const digest = this.secrets.hash(secret);
    const found = await this.tokens.findByHash(digest);
    if (!found) return null;
    if (!this.secrets.equals(found.token.tokenHash, digest)) return null;

    const now = this.clock.now();
    const { token, owner } = found;
    if (token.revokedAt !== null || token.expiresAt.getTime() <= now.getTime()) return null;
    if (owner.deletedAt !== null) return null;

    await this.tokens.touchLastUsed(token.id, now, new Date(now.getTime() - LAST_USED_INTERVAL_MS));
    return {
      userId: owner.id,
      clerkId: owner.clerkId,
      role: owner.role,
      email: owner.email,
      name: owner.name,
    };
  }
}
