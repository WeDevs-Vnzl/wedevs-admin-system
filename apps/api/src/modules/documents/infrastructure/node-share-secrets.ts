import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { ShareSecretsPort, UnlockCookieInput } from '../application/ports/share-secrets.port';
import {
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  SHARE_TOKEN_LENGTH,
  UNLOCK_COOKIE_MAX_AGE_SECONDS,
} from '../domain/share-link';

const SHARE_TOKEN_BYTES = 32;
/** Alphabet of generated keys: upper-case letters and digits without the look-alikes 0/O, 1/I/L. */
const ACCESS_KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ACCESS_KEY_GROUPS = 4;
const ACCESS_KEY_GROUP_LENGTH = 4;

/** scrypt cost parameters written into every new hash (`scrypt$N$r$p$<salt>$<hash>`). */
const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
/** Bounds accepted when reading a stored hash, so a corrupt row cannot ask for an absurd amount of work. */
const MAX_N = 1 << 20;
const MAX_R = 16;
const MAX_P = 4;
const MAX_UNLOCK_IDS = 50;
const B64URL = /^[A-Za-z0-9_-]+$/;

export interface NodeShareSecretsOptions {
  /** HMAC key of the unlock cookie (`SHARE_UNLOCK_SECRET`). */
  readonly unlockSecret: string;
  /** Salt of the IP hash (`SHARE_IP_SALT`). */
  readonly ipSalt: string;
}

interface ParsedHash {
  readonly options: { N: number; r: number; p: number };
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function derive(key: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // 128 · N · r bytes plus headroom; scrypt refuses to run above `maxmem`.
  const maxmem = 128 * (options.N ?? 0) * (options.r ?? 0) * 2 + 1024 * 1024;
  return new Promise((resolve, reject) => {
    scrypt(key.normalize('NFC'), salt, HASH_BYTES, { ...options, maxmem }, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

function keyLengthOk(key: string): boolean {
  return key.length >= ACCESS_KEY_MIN_LENGTH && key.length <= ACCESS_KEY_MAX_LENGTH;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  const validN = Number.isInteger(N) && N > 1 && N <= MAX_N && (N & (N - 1)) === 0;
  if (!validN || !Number.isInteger(R) || R < 1 || R > MAX_R) return null;
  if (!Number.isInteger(P) || P < 1 || P > MAX_P) return null;
  if (!B64URL.test(salt) || !B64URL.test(hash)) return null;
  const hashBuffer = Buffer.from(hash, 'base64url');
  if (hashBuffer.length !== HASH_BYTES) return null;
  return { options: { N, r: R, p: P }, salt: Buffer.from(salt, 'base64url'), hash: hashBuffer };
}

function isUnlockPayload(value: unknown): value is { l: string; ids: string[]; exp: number } {
  if (typeof value !== 'object' || value === null) return false;
  const { l, ids, exp } = value as Record<string, unknown>;
  return (
    typeof l === 'string' &&
    Array.isArray(ids) &&
    ids.length <= MAX_UNLOCK_IDS &&
    ids.every((id) => typeof id === 'string') &&
    typeof exp === 'number' &&
    Number.isInteger(exp)
  );
}

const linkIdOf = (token: string): string => createHash('sha256').update(token).digest('base64url');

/** `node:crypto` implementation of `ShareSecretsPort` (DT-45). The secrets are constructor arguments. */
export class NodeShareSecrets implements ShareSecretsPort {
  constructor(private readonly options: NodeShareSecretsOptions) {}

  generateToken(): string {
    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    if (token.length !== SHARE_TOKEN_LENGTH) throw new Error('Unexpected share token length');
    return token;
  }

  generateKey(): string {
    const groups: string[] = [];
    for (let group = 0; group < ACCESS_KEY_GROUPS; group += 1) {
      let chars = '';
      for (let index = 0; index < ACCESS_KEY_GROUP_LENGTH; index += 1) {
        chars += ACCESS_KEY_ALPHABET[randomInt(ACCESS_KEY_ALPHABET.length)];
      }
      groups.push(chars);
    }
    return groups.join('-');
  }

  async hashKey(key: string): Promise<string> {
    // The message never carries the key.
    if (!keyLengthOk(key)) {
      throw new RangeError(
        `Access keys must be ${ACCESS_KEY_MIN_LENGTH}-${ACCESS_KEY_MAX_LENGTH} characters long`,
      );
    }
    const { N, r, p } = SCRYPT;
    const salt = randomBytes(SALT_BYTES);
    const hash = await derive(key, salt, { N, r, p });
    return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
  }

  async verifyKey(key: string, stored: string): Promise<boolean> {
    const parsed = parseHash(stored);
    if (!parsed || !keyLengthOk(key)) return false;
    const candidate = await derive(key, parsed.salt, parsed.options);
    return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
  }

  signUnlock(input: UnlockCookieInput): string {
    const payload = Buffer.from(
      JSON.stringify({
        l: linkIdOf(input.token),
        ids: [...new Set(input.documentIds)].slice(0, MAX_UNLOCK_IDS),
        exp: input.now.getTime() + UNLOCK_COOKIE_MAX_AGE_SECONDS * 1000,
      }),
    ).toString('base64url');
    return `${payload}.${this.sign(payload).toString('base64url')}`;
  }

  verifyUnlock(value: string | undefined, token: string, now: Date): string[] {
    if (!value) return [];
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra !== undefined) return [];
    const expected = this.sign(payload);
    const given = Buffer.from(signature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [];
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return [];
    }
    if (!isUnlockPayload(decoded)) return [];
    if (decoded.l !== linkIdOf(token) || decoded.exp < now.getTime()) return [];
    return decoded.ids;
  }

  hashIp(ip: string): string {
    return createHash('sha256').update(`${this.options.ipSalt}:${ip}`).digest('hex');
  }

  private sign(payload: string): Buffer {
    return createHmac('sha256', this.options.unlockSecret).update(payload).digest();
  }
}
