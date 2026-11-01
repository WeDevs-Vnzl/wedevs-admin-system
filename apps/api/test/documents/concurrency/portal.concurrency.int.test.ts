import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimitPort } from '../../../src/modules/documents/application/ports/rate-limit.port';
import type { ShareAccessLogPort } from '../../../src/modules/documents/application/ports/share-access-log.port';
import type { ShareLinkRepository } from '../../../src/modules/documents/application/ports/share-link.repository.port';
import { PortalSupport } from '../../../src/modules/documents/application/use-cases/portal/portal-support';
import { RecordShareView } from '../../../src/modules/documents/application/use-cases/portal/record-share-view.use-case';
import { ResolveShareToken } from '../../../src/modules/documents/application/use-cases/portal/resolve-share-token.use-case';
import { UnlockSharedDocument } from '../../../src/modules/documents/application/use-cases/portal/unlock-shared-document.use-case';
import { NodeShareSecrets } from '../../../src/modules/documents/infrastructure/node-share-secrets';
import { PrismaPortalRead } from '../../../src/modules/documents/infrastructure/prisma-portal-read';
import { PrismaShareAccessLog } from '../../../src/modules/documents/infrastructure/prisma-share-access-log';
import { PrismaShareLinkRepository } from '../../../src/modules/documents/infrastructure/prisma-share-link.repository';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildShareWorld,
  Gate,
  gated,
  interleave,
  noLocks,
  readCommitted,
} from '../shares/real-world';

/**
 * The portal's concurrency rules over real PostgreSQL (lessons B3, M1; DT-45, A1, DT-126, DT-146):
 *  - N parallel wrong keys never exceed the lockout limit, and a right key during the lockout is refused;
 *  - N simultaneous views lose no count (the stored counters are atomic increments);
 *  - an unlock never writes a row after the link was revoked, and a resolve never waits for the revoke.
 * The lockout and revoke rules each have a deterministic gated test and a control that removes the lock and the
 * isolation (the unlocked behavior) to prove the test can fail. The views rule has no lock to remove: it is a
 * stress test of simultaneous requests against the atomic increment, with no gated control.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

const TOKEN = 'a'.repeat(43);
const KEY = 'RIGHT-KEY-2026-AAAA';
const IP = '203.0.113.7';
const LIMIT = 5;
const UNLOCK_SECRET = 'fake-unlock-secret-not-real-0000000000';
const IP_SALT = 'fake-ip-salt-not-real-000000000000000';

let owner: CurrentUser;

interface PortalHooks {
  shares?: (repository: ShareLinkRepository) => ShareLinkRepository;
  locks?: (locks: RowLocksPort) => RowLocksPort;
  uow?: (uow: UnitOfWorkPort) => UnitOfWorkPort;
  rateLimit?: (port: RateLimitPort) => RateLimitPort;
  accessLog?: (port: ShareAccessLogPort) => ShareAccessLogPort;
}

/** The portal use cases over the real adapters, one `TransactionHost` per world. */
function buildPortalWorld(hooks: PortalHooks = {}) {
  const host = new TransactionHost(service);
  const pass =
    <T>(): ((value: T) => T) =>
    (value) =>
      value;
  const uow = (hooks.uow ?? pass())(new PrismaUnitOfWork(host));
  const shares = (hooks.shares ?? pass())(new PrismaShareLinkRepository(host));
  const locks = (hooks.locks ?? pass())(new PrismaRowLocks(host));
  const log = new PrismaShareAccessLog(host);
  const rateLimit = (hooks.rateLimit ?? pass())(log);
  const accessLog = (hooks.accessLog ?? pass())(log);
  const secrets = new NodeShareSecrets({ unlockSecret: UNLOCK_SECRET, ipSalt: IP_SALT });
  let verified = 0;
  const counting = Object.create(secrets) as NodeShareSecrets;
  counting.verifyKey = (key, stored) => {
    verified += 1;
    return secrets.verifyKey(key, stored);
  };
  const support = new PortalSupport(
    shares,
    new PrismaPortalRead(host),
    counting,
    accessLog,
    uow,
    new SystemClock(),
    new CuidGenerator(),
    { listTypes: async () => [] },
    { resolve: async () => new Map() },
  );
  return {
    secrets,
    /** How many scrypt verifications this world ran. */
    get verified() {
      return verified;
    },
    resolve: new ResolveShareToken(support),
    recordView: new RecordShareView(support),
    unlock: new UnlockSharedDocument(support, uow, locks, rateLimit, accessLog),
  };
}

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_portal_conc', email: 'conc@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  await admin.document.create({
    data: {
      id: 'doc_a',
      code: 'DOC-A',
      title: 'Documento A',
      typeId: 'dtyp_nda',
      status: 'APROBADO',
      createdById: owner.userId,
    },
  });
  await admin.documentVersion.create({
    data: {
      id: 'doc_a_v1',
      documentId: 'doc_a',
      versionNumber: 1,
      format: 'MARKDOWN',
      content: '# 1',
      createdById: owner.userId,
    },
  });
  await admin.document.update({ where: { id: 'doc_a' }, data: { currentVersionId: 'doc_a_v1' } });
  const hash = await new NodeShareSecrets({
    unlockSecret: UNLOCK_SECRET,
    ipSalt: IP_SALT,
  }).hashKey(KEY);
  await admin.shareLink.create({
    data: {
      id: 'shr_a',
      token: TOKEN,
      title: 'Enlace',
      createdById: owner.userId,
      documents: {
        create: [
          { documentId: 'doc_a', order: 0, accessKeyHash: hash, accessKeyUpdatedAt: new Date() },
        ],
      },
    },
  });
}, 60_000);

/** The unlocked behavior, applied to the world under test as well as to the one racing it. */
const UNLOCKED: PortalHooks = { locks: noLocks, uow: readCommitted };

const visitor = (ip = IP) => ({ ip, userAgent: 'Vitest' });
const attempt = (world: ReturnType<typeof buildPortalWorld>, key: string, ip = IP) =>
  world.unlock.execute({ token: TOKEN, documentId: 'doc_a', key, visitor: visitor(ip) });
const settled = async (promises: Promise<unknown>[]) =>
  (await Promise.allSettled(promises)).map((result) =>
    result.status === 'fulfilled'
      ? 'OK'
      : ((result.reason as { code?: string }).code ?? String(result.reason)),
  );
const count = (event: string) =>
  admin.shareAccessLog.count({ where: { shareLinkId: 'shr_a', event: event as never } });

/** `n` failures of the visitor already counted, as the committed state before the race starts. */
async function seedFailures(n: number, ip = IP) {
  const ipHash = new NodeShareSecrets({ unlockSecret: UNLOCK_SECRET, ipSalt: IP_SALT }).hashIp(ip);
  for (let i = 0; i < n; i += 1) {
    await admin.shareAccessLog.create({
      data: {
        shareLinkId: 'shr_a',
        documentId: 'doc_a',
        event: 'UNLOCK_FAILED',
        ipHash,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
  }
}

describe('unlockSharedDocument: wrong keys never exceed the limit (DT-45, A1)', () => {
  /**
   * Four failures are already counted, so one more attempt is allowed. The first attempt pauses right after
   * counting; the second one then runs. With the `ShareLink` lock and `Serializable` the second waits, counts
   * five and is refused without being checked; without them both count four and both are checked.
   */
  async function lastAllowedAttempt(hooks: PortalHooks) {
    await seedFailures(LIMIT - 1);
    const gate = new Gate();
    const slow = buildPortalWorld({
      ...hooks,
      rateLimit: (port) => gated(port, gate, ['countFailures'], 'after'),
    });
    const fast = buildPortalWorld(hooks);
    const results = await interleave(
      admin,
      gate,
      () => attempt(slow, 'WRONG-KEY-AAAA'),
      () => attempt(fast, 'WRONG-KEY-BBBB'),
    );
    return {
      results,
      checked: slow.verified + fast.verified,
      failed: await count('UNLOCK_FAILED'),
    };
  }

  function expectWithinLimit(outcome: Awaited<ReturnType<typeof lastAllowedAttempt>>) {
    const codes = outcome.results.map((result) =>
      result.status === 'rejected' ? (result.reason as { code: string }).code : 'OK',
    );
    // The failure that reaches the limit already answers LOCKED; the one behind it is refused unchecked.
    expect(codes).toEqual(['ACCESS_KEY_LOCKED', 'ACCESS_KEY_LOCKED']);
    expect(outcome.failed).toBe(LIMIT);
    expect(outcome.checked).toBe(1);
  }

  it('serializes on the ShareLink row: the second attempt is counted after the first and refused', async () => {
    expectWithinLimit(await lastAllowedAttempt({}));
  });

  it('control: with no lock and ReadCommitted both attempts pass the limit check and a sixth failure is stored', async () => {
    const outcome = await lastAllowedAttempt(UNLOCKED);
    expect(outcome.failed).toBe(LIMIT + 1);
    expect(outcome.checked).toBe(2);
    expect(() => expectWithinLimit(outcome)).toThrow();
  });

  /**
   * Four failures are counted. A wrong key counts the fifth and pauses; the right key arrives behind it. With
   * the lock it is the sixth attempt and is refused unchecked, as the control of the limit says; without it
   * it counts four, is checked, and opens the document after the limit was reached.
   */
  async function rightKeyBehindTheFifthFailure(hooks: PortalHooks) {
    await seedFailures(LIMIT - 1);
    const gate = new Gate();
    const slow = buildPortalWorld({
      ...hooks,
      rateLimit: (port) => gated(port, gate, ['countFailures'], 'after'),
    });
    const fast = buildPortalWorld(hooks);
    const results = await interleave(
      admin,
      gate,
      () => attempt(slow, 'WRONG-KEY-AAAA'),
      () => attempt(fast, KEY),
    );
    return { results, unlocked: await count('UNLOCK') };
  }

  it('a right key racing the failure that reaches the limit is refused and never opens the document', async () => {
    const outcome = await rightKeyBehindTheFifthFailure({});
    expect(outcome.results[0]).toMatchObject({ status: 'rejected' });
    expect(outcome.results[1].status).toBe('rejected');
    expect((outcome.results[1] as PromiseRejectedResult).reason).toMatchObject({
      code: 'ACCESS_KEY_LOCKED',
    });
    expect(outcome.unlocked).toBe(0);
  });

  it('control: with no lock and ReadCommitted the right key is checked and opens the document past the limit', async () => {
    const outcome = await rightKeyBehindTheFifthFailure(UNLOCKED);
    expect(outcome.results[1].status).toBe('fulfilled');
    expect(outcome.unlocked).toBe(1);
  });

  it('twelve wrong keys in parallel: at most five are stored and checked, the rest are LOCKED or retry-exhausted CONFLICT', async () => {
    const world = buildPortalWorld();
    const wrong = (n: number) => `WRONG-KEY-${String(n).padStart(4, '0')}`;
    const codes = await settled(Array.from({ length: 12 }, (_, n) => attempt(world, wrong(n))));
    // Serializable plus a snapshot taken before the lock wait makes the tail of a burst retry; three retries
    // can run out and answer CONFLICT. Whatever the split, the limit holds and no guess is a success.
    expect(
      codes.every((code) => ['ACCESS_KEY_INVALID', 'ACCESS_KEY_LOCKED', 'CONFLICT'].includes(code)),
    ).toBe(true);
    expect(codes.filter((code) => code === 'ACCESS_KEY_INVALID').length).toBeLessThanOrEqual(
      LIMIT - 1,
    );
    expect(await count('UNLOCK_FAILED')).toBeLessThanOrEqual(LIMIT);
    expect(world.verified).toBeLessThanOrEqual(LIMIT);
    expect(world.verified).toBe(await count('UNLOCK_FAILED'));

    // Whatever CONFLICT left unused is spent one by one: the limit is exactly five, then LOCKED.
    for (let n = 0; n < LIMIT && (await count('UNLOCK_FAILED')) < LIMIT; n += 1) {
      await attempt(world, wrong(100 + n)).catch(() => undefined);
    }
    expect(await count('UNLOCK_FAILED')).toBe(LIMIT);
    await expect(attempt(world, wrong(200))).rejects.toMatchObject({ code: 'ACCESS_KEY_LOCKED' });
    expect(await count('UNLOCK_FAILED')).toBe(LIMIT);
  });

  it('a right key during the lockout is refused, never checked and never stored as UNLOCK', async () => {
    const world = buildPortalWorld();
    await settled(
      Array.from({ length: 8 }, (_, n) =>
        attempt(world, `WRONG-KEY-${String(n).padStart(4, '0')}`),
      ),
    );
    const checkedBefore = world.verified;
    await expect(attempt(world, KEY)).rejects.toMatchObject({ code: 'ACCESS_KEY_LOCKED' });
    expect(world.verified).toBe(checkedBefore);
    expect(await count('UNLOCK')).toBe(0);
    expect(await count('UNLOCK_FAILED')).toBe(LIMIT);
    // Another visitor is not locked out.
    await expect(attempt(world, KEY, '198.51.100.9')).resolves.toMatchObject({ unlocked: true });
  });

  it('simultaneous right keys from different visitors are never answered as a lockout', async () => {
    const world = buildPortalWorld();
    const codes = await settled(
      Array.from({ length: 6 }, (_, n) => attempt(world, KEY, `198.51.100.${n + 1}`)),
    );
    // Visitors do not share a counter: nothing is INVALID or LOCKED. A contended Serializable run may
    // exhaust its retries (CONFLICT); every success is an UNLOCK row and a rolled-back attempt leaves no failure row.
    expect(codes.every((code) => code === 'OK' || code === 'CONFLICT')).toBe(true);
    expect(codes).toContain('OK');
    expect(await count('UNLOCK')).toBe(codes.filter((code) => code === 'OK').length);
    expect(await count('UNLOCK_FAILED')).toBe(0);
  });
});

describe('recordShareView: N simultaneous views lose no count (contract choice 4)', () => {
  it('stores N rows and N on the counter, by atomic increment', async () => {
    const world = buildPortalWorld();
    const codes = await settled(
      Array.from({ length: 20 }, () =>
        world.recordView.execute({ token: TOKEN, visitor: visitor() }),
      ),
    );
    expect(codes).toEqual(Array(20).fill('OK'));
    const link = await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } });
    expect(link.viewCount).toBe(20);
    expect(link.lastAccessedAt).not.toBeNull();
    expect(await count('VIEW')).toBe(20);
  });

  it('views of the page and of one document racing all count', async () => {
    const world = buildPortalWorld();
    await settled([
      ...Array.from({ length: 10 }, () =>
        world.recordView.execute({ token: TOKEN, visitor: visitor() }),
      ),
      ...Array.from({ length: 10 }, () =>
        world.recordView.execute({ token: TOKEN, documentId: 'doc_a', visitor: visitor() }),
      ),
    ]);
    const link = await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } });
    expect(link.viewCount).toBe(20);
    expect(await count('VIEW')).toBe(20);
  });
});

describe('revoke versus the portal', () => {
  const stamp = async () => ({
    link: await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } }),
    rows: await admin.shareAccessLog.findMany({ where: { shareLinkId: 'shr_a' } }),
  });

  /**
   * The unlock reads the link inside its unit of work and pauses; the revoke runs meanwhile. With the lock the
   * revoke waits for the unlock to commit; without it the revoke commits first and the unlock then writes a row
   * for a link that is already revoked.
   */
  async function unlockVsRevoke(hooks: PortalHooks) {
    const gate = new Gate();
    const slow = buildPortalWorld({
      ...hooks,
      shares: (repository) => gated(repository, gate, ['findById'], 'after'),
    });
    const fast = buildShareWorld(service, {
      ...(hooks.locks ? { locks: hooks.locks } : {}),
      ...(hooks.uow ? { uow: hooks.uow } : {}),
    });
    const results = await interleave(
      admin,
      gate,
      () => attempt(slow, 'WRONG-KEY-AAAA'),
      () => fast.revokeShareLink.execute(owner, { id: 'shr_a' }),
    );
    return { results, ...(await stamp()) };
  }

  function expectNothingAfterRevoke(outcome: Awaited<ReturnType<typeof unlockVsRevoke>>) {
    const revokedAt = outcome.link.revokedAt as Date;
    expect(revokedAt).not.toBeNull();
    for (const row of outcome.rows) {
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(revokedAt.getTime());
    }
  }

  it('serialize on the ShareLink row: the unlock commits first, then the revoke closes the link', async () => {
    const outcome = await unlockVsRevoke({});
    expect(outcome.results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect((outcome.results[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'ACCESS_KEY_INVALID',
    });
    expect(outcome.rows.map((row) => row.event)).toEqual(['UNLOCK_FAILED']);
    expectNothingAfterRevoke(outcome);
  });

  it('control: with no lock and ReadCommitted the unlock logs an attempt after the link was revoked', async () => {
    const outcome = await unlockVsRevoke(UNLOCKED);
    expect(outcome.rows.map((row) => row.event)).toEqual(['UNLOCK_FAILED']);
    expect(() => expectNothingAfterRevoke(outcome)).toThrow();
  });

  it('a revoke that holds the lock wins: the unlock behind it is NOT_FOUND and writes nothing', async () => {
    const gate = new Gate();
    const slow = buildShareWorld(service, {
      shares: (repository) => gated(repository, gate, ['revoke'], 'before'),
    });
    const fast = buildPortalWorld();
    const results = await interleave(
      admin,
      gate,
      () => slow.revokeShareLink.execute(owner, { id: 'shr_a' }),
      () => attempt(fast, KEY),
    );
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'NOT_FOUND' });
    expect((await stamp()).rows).toEqual([]);
    expect(fast.verified).toBe(0);
  });

  it('resolve never waits for a revoke in flight: it reads the committed link, then answers 404 once revoked', async () => {
    const gate = new Gate();
    const slow = buildShareWorld(service, {
      shares: (repository) => gated(repository, gate, ['revoke'], 'before'),
    });
    const reader = buildPortalWorld();
    const revoking = slow.revokeShareLink.execute(owner, { id: 'shr_a' });
    revoking.catch(() => undefined);
    await gate.arrived;
    // The revoke holds the ShareLink row lock now; the page still resolves, without waiting.
    const page = await reader.resolve.execute({ token: TOKEN, visitor: visitor() });
    expect(page.title).toBe('Enlace');
    gate.release();
    await revoking;
    await expect(
      reader.resolve.execute({ token: TOKEN, visitor: visitor() }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
