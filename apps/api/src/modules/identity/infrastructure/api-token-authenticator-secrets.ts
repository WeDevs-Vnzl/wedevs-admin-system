import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  ApiTokenSecretsPort,
  GeneratedApiTokenSecret,
} from '../application/ports/api-token-secrets.port';

const SECRET_PREFIX = 'wdc_pat_';
const SECRET_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;

/** `node:crypto` adapter: 32 CSPRNG bytes as base64url (43 chars), SHA-256 hex digests, constant-time compare. */
export class NodeApiTokenSecrets implements ApiTokenSecretsPort {
  generate(): GeneratedApiTokenSecret {
    const secret = `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString('base64url')}`;
    return { secret, prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH), hash: this.hash(secret) };
  }

  hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  equals(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
