// MOCK — share-link secrets of Hito 1 (PRD §8.11; DT-45, C22): share tokens, portal access keys and their scrypt
// hashes. Framework-free (C11): only `node:crypto`. Shared by the back-office shares service (H1-B4 T7) and the
// portal service (T9), which verifies keys with `verifyAccessKey`. Replaced by `src/server/services/*` in Hito 2.
//
// Security contract: a clear key exists only in memory between `generateAccessKey` and the mutation result that
// shows it once; only `hashAccessKey` output is stored. Verification is constant-time (`timingSafeEqual`).
import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import {
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  SHARE_TOKEN_LENGTH,
} from "@/lib/validators/shares";

/** Random bytes behind a share token: 32 bytes → 43 base64url characters (`SHARE_TOKEN_LENGTH`). */
export const SHARE_TOKEN_BYTES = 32;

/** A new share token from the CSPRNG: 32 random bytes in base64url (no padding), 43 characters. */
export function generateShareToken(): string {
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  if (token.length !== SHARE_TOKEN_LENGTH) throw new Error("Unexpected share token length");
  return token;
}

/** Alphabet of generated keys: upper-case letters and digits without the look-alikes 0/O, 1/I/L. */
export const ACCESS_KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ACCESS_KEY_GROUPS = 4;
const ACCESS_KEY_GROUP_LENGTH = 4;

/**
 * A new access key from the CSPRNG (`randomInt` is unbiased): four groups of four characters joined by `-`, e.g.
 * `K7QM-2XRP-H9VD-T4NA` (19 characters, ~79 bits). Shown to the owner once; never stored in clear.
 */
export function generateAccessKey(): string {
  const groups: string[] = [];
  for (let group = 0; group < ACCESS_KEY_GROUPS; group += 1) {
    let chars = "";
    for (let index = 0; index < ACCESS_KEY_GROUP_LENGTH; index += 1) {
      chars += ACCESS_KEY_ALPHABET[randomInt(ACCESS_KEY_ALPHABET.length)];
    }
    groups.push(chars);
  }
  return groups.join("-");
}

/** scrypt cost parameters written into every new hash (`scrypt$N$r$p$<salt>$<hash>`). */
export const ACCESS_KEY_SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
/** Bounds accepted when reading a stored hash, so a corrupt row cannot ask for an absurd amount of work. */
const MAX_N = 1 << 20;
const MAX_R = 16;
const MAX_P = 4;

function derive(key: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // 128 · N · r bytes plus headroom; scrypt refuses to run above `maxmem`.
  const maxmem = 128 * (options.N ?? 0) * (options.r ?? 0) * 2 + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(key.normalize("NFC"), salt, HASH_BYTES, { ...options, maxmem }, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

function assertKeyLength(key: string): void {
  if (key.length < ACCESS_KEY_MIN_LENGTH || key.length > ACCESS_KEY_MAX_LENGTH) {
    throw new RangeError(
      `Access keys must be ${ACCESS_KEY_MIN_LENGTH}–${ACCESS_KEY_MAX_LENGTH} characters long`,
    );
  }
}

/**
 * The stored form of `key`: `scrypt$N$r$p$<salt>$<hash>` with a fresh 16-byte salt per call (base64url), so the
 * same key never hashes to the same value twice. Throws a `RangeError` for a key outside 8–128 characters.
 */
export async function hashAccessKey(key: string): Promise<string> {
  assertKeyLength(key);
  const { N, r, p } = ACCESS_KEY_SCRYPT;
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(key, salt, { N, r, p });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

interface ParsedHash {
  options: { N: number; r: number; p: number };
  salt: Buffer;
  hash: Buffer;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  const validN = Number.isInteger(N) && N > 1 && N <= MAX_N && (N & (N - 1)) === 0;
  if (!validN || !Number.isInteger(R) || R < 1 || R > MAX_R) return null;
  if (!Number.isInteger(P) || P < 1 || P > MAX_P) return null;
  if (!B64URL.test(salt) || !B64URL.test(hash)) return null;
  const hashBuffer = Buffer.from(hash, "base64url");
  if (hashBuffer.length !== HASH_BYTES) return null;
  return { options: { N, r: R, p: P }, salt: Buffer.from(salt, "base64url"), hash: hashBuffer };
}

/**
 * Whether `key` matches the stored hash, compared in constant time (`timingSafeEqual`) with the parameters and
 * salt recorded in the hash. A malformed hash, or a key outside 8–128 characters, is a mismatch (`false`), never
 * an exception. The caller trims the key first (`accessKeyInputSchema`).
 */
export async function verifyAccessKey(key: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  if (key.length < ACCESS_KEY_MIN_LENGTH || key.length > ACCESS_KEY_MAX_LENGTH) return false;
  const candidate = await derive(key, parsed.salt, parsed.options);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}
