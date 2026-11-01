import { describe, expect, it } from 'vitest';
import {
  createPortalWorld,
  KEY,
  OTHER_TOKEN,
  TOKEN,
  visitor,
  type PortalWorld,
} from '../../../../../../test/documents/portal/world';
import { ACCESS_KEY_LOCKOUT_MINUTES, ACCESS_KEY_MAX_FAILED_ATTEMPTS } from '../../../domain';

// Ported from `portal-shares.test.ts` (`unlockSharedDocument`; DT-45, A1). The parallel-guess case of the mock
// is the real-database spec `portal.concurrency.int.test.ts`: the in-memory unit of work is single-flight.

const DOCS = [
  { id: 'doc_cred', key: KEY, format: 'ENLACE' as const, url: 'https://x.test' },
  { id: 'doc_prd' },
];
const OTHER_IP = '198.51.100.9';

const unlock = (
  w: PortalWorld,
  key: string,
  ip?: string,
  cookie?: string,
  documentId = 'doc_cred',
) =>
  w.unlock.execute({
    token: TOKEN,
    documentId,
    key,
    visitor: visitor({ ...(ip ? { ip } : {}), unlockCookie: cookie }),
  });

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: { code?: string }) => error.code ?? 'ERR',
  );

async function seeded(): Promise<PortalWorld> {
  const w = createPortalWorld();
  await w.seedLink(DOCS);
  return w;
}

describe('UnlockSharedDocument', () => {
  it('unlocks with the right key, logs UNLOCK and returns the signed cookie', async () => {
    const w = await seeded();
    const result = await unlock(w, KEY);
    expect(result).toMatchObject({ documentId: 'doc_cred', unlocked: true });
    expect(w.accessLog.rows.map((row) => row.event)).toEqual(['UNLOCK']);
    expect(w.accessLog.rows[0]).toMatchObject({ documentId: 'doc_cred', userAgent: 'Vitest' });
    expect(w.secrets.verifyUnlock(result.unlockCookie ?? undefined, TOKEN, w.clock.now())).toEqual([
      'doc_cred',
    ]);
    expect(w.accessLog.countersOf('shr_a').lastAccessedAt).toEqual(w.clock.now());
    expect(w.accessLog.countersOf('shr_a').viewCount).toBe(0);
  });

  it('adds to the ids the request cookie already held', async () => {
    const w = createPortalWorld();
    await w.seedLink([...DOCS, { id: 'doc_two', key: KEY }]);
    const first = await unlock(w, KEY);
    const second = await unlock(w, KEY, undefined, first.unlockCookie ?? undefined, 'doc_two');
    expect(
      w.secrets.verifyUnlock(second.unlockCookie ?? undefined, TOKEN, w.clock.now()).sort(),
    ).toEqual(['doc_cred', 'doc_two']);
  });

  it('trims the typed key', async () => {
    const w = await seeded();
    await expect(unlock(w, `  ${KEY}  `)).resolves.toMatchObject({ unlocked: true });
  });

  it('answers ACCESS_KEY_INVALID for a wrong key and logs UNLOCK_FAILED, never the key', async () => {
    const w = await seeded();
    expect(await code(unlock(w, 'WRONG-KEY-0000'))).toBe('ACCESS_KEY_INVALID');
    expect(w.accessLog.rows.map((row) => row.event)).toEqual(['UNLOCK_FAILED']);
    expect(JSON.stringify(w.accessLog.rows)).not.toContain('WRONG-KEY-0000');
    expect(w.accessLog.countersOf('shr_a').lastAccessedAt).toBeNull();
  });

  it(`locks the document for this IP after ${ACCESS_KEY_MAX_FAILED_ATTEMPTS} failures, even for the right key`, async () => {
    const w = await seeded();
    const codes: string[] = [];
    for (let attempt = 1; attempt <= ACCESS_KEY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      codes.push(await code(unlock(w, `WRONG-KEY-000${attempt}`)));
    }
    expect(codes).toEqual([
      'ACCESS_KEY_INVALID',
      'ACCESS_KEY_INVALID',
      'ACCESS_KEY_INVALID',
      'ACCESS_KEY_INVALID',
      'ACCESS_KEY_LOCKED',
    ]);
    expect(await code(unlock(w, KEY))).toBe('ACCESS_KEY_LOCKED');
    // The refused attempt is not counted again, and nothing is logged for it.
    expect(w.accessLog.eventsOf('UNLOCK_FAILED')).toHaveLength(ACCESS_KEY_MAX_FAILED_ATTEMPTS);
    expect(w.accessLog.eventsOf('UNLOCK')).toHaveLength(0);
    // Another visitor is not affected.
    expect(await code(unlock(w, KEY, OTHER_IP))).toBe('OK');
  });

  it(`lifts the lockout ${ACCESS_KEY_LOCKOUT_MINUTES} minutes after the last counted failure`, async () => {
    const w = await seeded();
    for (let attempt = 1; attempt <= ACCESS_KEY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await code(unlock(w, `WRONG-KEY-000${attempt}`));
    }
    w.clock.advance(ACCESS_KEY_LOCKOUT_MINUTES * 60_000 - 1);
    expect(await code(unlock(w, KEY))).toBe('ACCESS_KEY_LOCKED');
    w.clock.advance(2);
    expect(await code(unlock(w, KEY))).toBe('OK');
  });

  it('keys the lockout on the document: another document of the link is not locked', async () => {
    const w = createPortalWorld();
    await w.seedLink([...DOCS, { id: 'doc_two', key: KEY }]);
    for (let attempt = 1; attempt <= ACCESS_KEY_MAX_FAILED_ATTEMPTS; attempt += 1) {
      await code(unlock(w, `WRONG-KEY-000${attempt}`));
    }
    expect(await code(unlock(w, KEY, undefined, undefined, 'doc_two'))).toBe('OK');
  });

  it('does not count a key outside 8-128 characters after trimming: VALIDATION, no row', async () => {
    const w = await seeded();
    expect(await code(unlock(w, 'short'))).toBe('VALIDATION');
    expect(await code(unlock(w, `   ${'a'.repeat(7)}   `))).toBe('VALIDATION');
    expect(await code(unlock(w, 'a'.repeat(129)))).toBe('VALIDATION');
    expect(w.accessLog.rows).toEqual([]);
  });

  it('answers unlocked without a log row for a document without a key', async () => {
    const w = await seeded();
    const result = await unlock(w, 'ANY-KEY-THAT-LONG', undefined, undefined, 'doc_prd');
    expect(result).toEqual({ documentId: 'doc_prd', unlocked: true, unlockCookie: null });
    expect(w.accessLog.rows).toEqual([]);
  });

  it('answers NOT_FOUND for a document outside the link and for dead or malformed tokens', async () => {
    const w = await seeded();
    expect(await code(unlock(w, KEY, undefined, undefined, 'doc_other'))).toBe('NOT_FOUND');
    for (const token of [OTHER_TOKEN, 'short']) {
      expect(
        await code(
          w.unlock.execute({ token, documentId: 'doc_cred', key: KEY, visitor: visitor() }),
        ),
      ).toBe('NOT_FOUND');
    }
    expect(w.accessLog.rows).toEqual([]);
  });

  it('answers NOT_FOUND, writing nothing, when the link was revoked before the lock was taken', async () => {
    const w = await seeded();
    await w.uow.run(() => w.shares.revoke('shr_a', w.clock.now()));
    expect(await code(unlock(w, KEY))).toBe('NOT_FOUND');
    expect(w.accessLog.rows).toEqual([]);
  });

  it('counts inside a Serializable unit of work that locks the ShareLink, and runs scrypt outside any unit of work', async () => {
    const w = await seeded();
    const runs: (string | undefined)[] = [];
    const run = w.uow.run.bind(w.uow);
    w.uow.run = (work, options) => {
      if (!w.uow.isActive) runs.push(options?.isolation);
      return run(work, options);
    };
    const locked: unknown[] = [];
    const lock = w.locks.lock.bind(w.locks);
    w.locks.lock = (set) => {
      locked.push(set);
      return lock(set);
    };
    const during: boolean[] = [];
    const verify = w.secrets.verifyKey.bind(w.secrets);
    w.secrets.verifyKey = (key, stored) => {
      during.push(w.uow.isActive);
      return verify(key, stored);
    };

    await unlock(w, KEY);

    expect(runs).toEqual(['Serializable', 'ReadCommitted']);
    expect(locked).toEqual([{ ShareLink: ['shr_a'] }]);
    expect(during).toEqual([false]);
  });
});
