import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NodeApiTokenSecrets } from '../../../src/modules/identity/infrastructure/api-token-authenticator-secrets';

const secrets = new NodeApiTokenSecrets();

describe('NodeApiTokenSecrets', () => {
  it('generates wdc_pat_ + 43 base64url characters with a 12-char prefix and the SHA-256 hex', () => {
    const g = secrets.generate();
    expect(g.secret).toMatch(/^wdc_pat_[A-Za-z0-9_-]{43}$/);
    expect(g.prefix).toBe(g.secret.slice(0, 12));
    expect(g.hash).toBe(createHash('sha256').update(g.secret).digest('hex'));
    expect(secrets.hash(g.secret)).toBe(g.hash);
    expect(secrets.generate().secret).not.toBe(g.secret);
  });

  it('compares digests, false on any difference or length mismatch', () => {
    const a = secrets.hash('x');
    expect(secrets.equals(a, a)).toBe(true);
    expect(secrets.equals(a, secrets.hash('y'))).toBe(false);
    expect(secrets.equals(a, a.slice(1))).toBe(false);
    expect(secrets.equals(a, '')).toBe(false);
  });
});
