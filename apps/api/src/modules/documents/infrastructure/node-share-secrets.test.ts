import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { UNLOCK_COOKIE_MAX_AGE_SECONDS } from '../domain/share-link';
import { NodeShareSecrets } from './node-share-secrets';

const SECRET = 'test-secret-of-at-least-32-characters!!';
const secrets = new NodeShareSecrets({ unlockSecret: SECRET, ipSalt: 'salt-1' });
const TOKEN = 'A'.repeat(43);
const OTHER_TOKEN = 'B'.repeat(43);
const NOW = new Date('2026-10-09T15:00:00.000Z');
const KEY = 'K7QM-2XRP-H9VD-T4NA';

describe('generateToken', () => {
  it('is 32 random bytes in base64url: 43 characters, unique', () => {
    const token = secrets.generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secrets.generateToken()).not.toBe(token);
  });
});

describe('generateKey', () => {
  it('is four groups of four from the unambiguous alphabet, 19 characters', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(secrets.generateKey()).toMatch(/^([A-HJKMNP-Z2-9]{4}-){3}[A-HJKMNP-Z2-9]{4}$/);
    }
    expect(secrets.generateKey()).toHaveLength(19);
    expect(secrets.generateKey()).not.toBe(secrets.generateKey());
  });
});

describe('hashKey / verifyKey (scrypt, constant time)', () => {
  it('stores scrypt$N$r$p$salt$hash and verifies the right key only', async () => {
    const stored = await secrets.hashKey(KEY);
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain(KEY);
    expect(await secrets.verifyKey(KEY, stored)).toBe(true);
    expect(await secrets.verifyKey('K7QM-2XRP-H9VD-T4NB', stored)).toBe(false);
  });

  it('uses a different salt per hash', async () => {
    const [a, b] = [await secrets.hashKey(KEY), await secrets.hashKey(KEY)];
    expect(a).not.toBe(b);
    expect(a.split('$')[4]).not.toBe(b.split('$')[4]);
    expect(await secrets.verifyKey(KEY, a)).toBe(true);
    expect(await secrets.verifyKey(KEY, b)).toBe(true);
  });

  it('a malformed stored hash is false, never an exception', async () => {
    const salt = Buffer.alloc(16).toString('base64url');
    const hash = Buffer.alloc(32).toString('base64url');
    for (const stored of [
      '',
      'garbage',
      'bcrypt$16384$8$1$a$b',
      `scrypt$16384$8$1$${salt}`,
      `scrypt$abc$8$1$${salt}$${hash}`,
      `scrypt$1000$8$1$${salt}$${hash}`,
      `scrypt$${2 ** 21}$8$1$${salt}$${hash}`,
      `scrypt$16384$0$1$${salt}$${hash}`,
      `scrypt$16384$17$1$${salt}$${hash}`,
      `scrypt$16384$8$5$${salt}$${hash}`,
      `scrypt$16384$8$1$${salt}$short`,
      `scrypt$16384$8$1$sal!t$${hash}`,
    ]) {
      expect(await secrets.verifyKey(KEY, stored), stored).toBe(false);
    }
  });

  it('a key outside 8-128 characters is false on verify and a RangeError on hash', async () => {
    const stored = await secrets.hashKey(KEY);
    expect(await secrets.verifyKey('short', stored)).toBe(false);
    expect(await secrets.verifyKey('x'.repeat(129), stored)).toBe(false);
    await expect(secrets.hashKey('short')).rejects.toBeInstanceOf(RangeError);
  });

  it('never puts the clear key in a thrown message', async () => {
    const bad = 'tiny-k';
    const error = await secrets.hashKey(bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(bad);
    const long = 'z'.repeat(200);
    const longError = await secrets.hashKey(long).catch((e: unknown) => e);
    expect((longError as Error).message).not.toContain(long);
  });
});

describe('unlock cookie (C22)', () => {
  it('round-trips the unlocked ids of its own token', () => {
    const value = secrets.signUnlock({ token: TOKEN, documentIds: ['doc_1', 'doc_2'], now: NOW });
    expect(secrets.verifyUnlock(value, TOKEN, NOW)).toEqual(['doc_1', 'doc_2']);
  });

  it('never carries the token in clear', () => {
    const value = secrets.signUnlock({ token: TOKEN, documentIds: ['doc_1'], now: NOW });
    expect(value).not.toContain(TOKEN);
  });

  it('is worth nothing for another link', () => {
    const value = secrets.signUnlock({ token: TOKEN, documentIds: ['doc_1'], now: NOW });
    expect(secrets.verifyUnlock(value, OTHER_TOKEN, NOW)).toEqual([]);
  });

  it('is worth nothing once tampered with or signed with another secret', () => {
    const value = secrets.signUnlock({ token: TOKEN, documentIds: ['doc_1'], now: NOW });
    const [payload, signature] = value.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, 'base64url').toString()),
        ids: ['doc_1', 'doc_9'],
      }),
    ).toString('base64url');
    expect(secrets.verifyUnlock(`${forged}.${signature}`, TOKEN, NOW)).toEqual([]);
    const other = new NodeShareSecrets({ unlockSecret: `${SECRET}-other`, ipSalt: 'salt-1' });
    expect(other.verifyUnlock(value, TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock('garbage', TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock('a.b.c', TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock(undefined, TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock('', TOKEN, NOW)).toEqual([]);
  });

  it('a correctly signed but malformed payload is worth nothing', () => {
    const signed = (body: unknown): string => {
      const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
      return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
    };
    const l = createHash('sha256').update(TOKEN).digest('base64url');
    const exp = NOW.getTime() + 1000;
    expect(secrets.verifyUnlock(signed({ l, ids: ['doc_1'], exp }), TOKEN, NOW)).toEqual(['doc_1']);
    expect(secrets.verifyUnlock(signed({ l, ids: 'doc_1', exp }), TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock(signed({ l, ids: [1], exp }), TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock(signed({ l, ids: ['a'], exp: 'x' }), TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock(signed({ l: 1, ids: [], exp }), TOKEN, NOW)).toEqual([]);
    expect(secrets.verifyUnlock(signed(null), TOKEN, NOW)).toEqual([]);
    expect(
      secrets.verifyUnlock(
        signed({ l, ids: Array.from({ length: 51 }, (_, i) => `d${i}`), exp }),
        TOKEN,
        NOW,
      ),
    ).toEqual([]);
    const notJson = Buffer.from('not json').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(notJson).digest('base64url');
    expect(secrets.verifyUnlock(`${notJson}.${sig}`, TOKEN, NOW)).toEqual([]);
  });

  it(`expires ${UNLOCK_COOKIE_MAX_AGE_SECONDS / 3600} h after it was signed`, () => {
    const value = secrets.signUnlock({ token: TOKEN, documentIds: ['doc_1'], now: NOW });
    const edge = new Date(NOW.getTime() + UNLOCK_COOKIE_MAX_AGE_SECONDS * 1000);
    expect(secrets.verifyUnlock(value, TOKEN, edge)).toEqual(['doc_1']);
    expect(secrets.verifyUnlock(value, TOKEN, new Date(edge.getTime() + 1))).toEqual([]);
  });

  it('dedupes and caps the ids at 50', () => {
    const ids = Array.from({ length: 60 }, (_, i) => `d${i}`);
    const value = secrets.signUnlock({ token: TOKEN, documentIds: [...ids, 'd0'], now: NOW });
    expect(secrets.verifyUnlock(value, TOKEN, NOW)).toEqual(ids.slice(0, 50));
  });
});

describe('hashIp (C20)', () => {
  it('is the salted SHA-256 of the IP in lowercase hex, never the raw IP', () => {
    const hash = secrets.hashIp('203.0.113.7');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('203.0.113.7');
    expect(hash).toBe(createHash('sha256').update('salt-1:203.0.113.7').digest('hex'));
    expect(secrets.hashIp('203.0.113.7')).toBe(hash);
    const other = new NodeShareSecrets({ unlockSecret: SECRET, ipSalt: 'salt-2' });
    expect(other.hashIp('203.0.113.7')).not.toBe(hash);
  });
});
