/**
 * Secrets of share links and the portal (DT-45, C22): tokens, access keys and their scrypt hashes, the signed
 * unlock cookie and the salted IP hash. The adapter holds the configured secrets; callers never see them.
 *
 * A clear key exists only between `generateKey` and the response that shows it once; only `hashKey` output is stored.
 */
export interface UnlockCookieInput {
  readonly token: string;
  readonly documentIds: readonly string[];
  readonly now: Date;
}

export interface ShareSecretsPort {
  /** 32 random bytes in base64url, 43 characters. */
  generateToken(): string;
  /** Four groups of four characters from an unambiguous alphabet, 19 characters. */
  generateKey(): string;
  /** `scrypt$N$r$p$<salt>$<hash>` with a fresh salt. Rejects a key outside 8-128 characters (`RangeError`). */
  hashKey(key: string): Promise<string>;
  /** Constant-time check. A malformed hash or a key outside 8-128 characters is `false`, never an exception. */
  verifyKey(key: string, stored: string): Promise<boolean>;
  /** A signed cookie value listing `documentIds` as unlocked for the link of `token`, valid 12 h from `now`. */
  signUnlock(input: UnlockCookieInput): string;
  /** The unlocked ids, or `[]` when missing, malformed, forged, expired or for another link. */
  verifyUnlock(value: string | undefined, token: string, now: Date): string[];
  /** Salted SHA-256 of the visitor IP, lowercase hex (C20): the raw IP never leaves the adapter. */
  hashIp(ip: string): string;
}

/** Nest injection token of the port. */
export const SHARE_SECRETS = Symbol('SHARE_SECRETS');
