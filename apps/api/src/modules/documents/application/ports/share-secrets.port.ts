/**
 * Secrets of share links and the portal (DT-45, C22): tokens, access keys and their scrypt hashes, the signed
 * unlock cookie and the salted IP hash. The adapter holds the configured secrets; callers never see them.
 *
 * A clear key exists only between `generateKey` and the response that shows it once; only `hashKey` output is stored.
 */
/** One unlocked document and the instant its own unlock ends (12 h after that document was unlocked). */
export interface UnlockGrant {
  readonly documentId: string;
  readonly expiresAt: Date;
}

export interface UnlockCookieInput {
  readonly token: string;
  /** Each document keeps its own expiry: unlocking one never extends another. */
  readonly grants: readonly UnlockGrant[];
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
  /**
   * A signed cookie value listing `grants` as unlocked for the link of `token`, each with its own expiry;
   * a grant already expired at `now` is dropped.
   */
  signUnlock(input: UnlockCookieInput): string;
  /**
   * The live grants, or `[]` when the value is missing, malformed, forged, in an older payload shape or for
   * another link. A grant expired at `now` is dropped; the others stay.
   */
  verifyUnlock(value: string | undefined, token: string, now: Date): UnlockGrant[];
  /** Salted SHA-256 of the visitor IP, lowercase hex (C20): the raw IP never leaves the adapter. */
  hashIp(ip: string): string;
}

/** Nest injection token of the port. */
export const SHARE_SECRETS = Symbol('SHARE_SECRETS');
