import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  ApiTokenSecretsPort,
  GeneratedApiTokenSecret,
} from '../../../src/modules/identity/application/ports/api-token-secrets.port';

/** Deterministic secrets (`wdc_pat_` + 43 chars) with the real SHA-256, so hashes match the adapter's. */
export class InMemoryApiTokenSecrets implements ApiTokenSecretsPort {
  private counter = 0;
  /** Every secret handed out, so tests can assert none of them leaks. */
  readonly issued: string[] = [];

  generate(): GeneratedApiTokenSecret {
    this.counter += 1;
    const secret = `wdc_pat_${String(this.counter).padStart(43, 'A')}`;
    this.issued.push(secret);
    return { secret, prefix: secret.slice(0, 12), hash: this.hash(secret) };
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
