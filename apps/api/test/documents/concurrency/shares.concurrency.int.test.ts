import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { must } from '../shares/must';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildShareWorld,
  Gate,
  gated,
  interleave,
  noLocks,
  readCommitted,
  type ShareWorldHooks,
} from '../shares/real-world';

/**
 * Concurrent share-link mutations over real PostgreSQL (lessons B3, M1; DT-126, DT-146). The first transaction is
 * paused once it holds what it read (the `ShareLink` row lock) around its write; the second one then runs. With
 * the row lock and `Serializable` the second waits and reads the committed state; without them it works on a
 * stale read and the commits disagree.
 */
const admin = createTestPrisma();
const service = new PrismaService({ DATABASE_URL: process.env.DATABASE_URL as string });

let owner: CurrentUser;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

const KEY_HASH_PREFIX = 'scrypt$';

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_share_conc', email: 'conc@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  for (const id of ['doc_a', 'doc_b', 'doc_c']) {
    await admin.document.create({
      data: {
        id,
        code: `DOC-${id}`,
        title: `Documento ${id}`,
        typeId: 'dtyp_nda',
        status: 'APROBADO',
        createdById: owner.userId,
      },
    });
    await admin.documentVersion.create({
      data: {
        id: `${id}_v1`,
        documentId: id,
        versionNumber: 1,
        format: 'MARKDOWN',
        content: '# 1',
        createdById: owner.userId,
      },
    });
    await admin.document.update({ where: { id }, data: { currentVersionId: `${id}_v1` } });
  }
  await admin.shareLink.create({
    data: {
      id: 'shr_a',
      token: 'a'.repeat(43),
      title: 'Enlace',
      createdById: owner.userId,
      documents: { create: [{ documentId: 'doc_a', order: 0 }] },
    },
  });
}, 60_000);

/** The unlocked behavior, applied to the world under test as well as to the one racing it. */
const UNLOCKED: ShareWorldHooks = { locks: noLocks, uow: readCommitted };

/**
 * Two worlds, the first one paused right at the repository method `pauseOn` (`before` or `after` its call):
 * it then holds whatever the use case locked, and the second one either waits for it (lock) or runs on a
 * stale read.
 */
function twoWorlds(pauseOn: string, when: 'before' | 'after', hooks: ShareWorldHooks = {}) {
  const gate = new Gate();
  const slow = buildShareWorld(service, {
    ...hooks,
    shares: (repository) => gated(repository, gate, [pauseOn], when),
  });
  const fast = buildShareWorld(service, hooks);
  return { gate, slow, fast };
}

const entries = (actions: string[]) =>
  admin.activityLog.findMany({
    where: { entityType: 'SHARE_LINK', entityId: 'shr_a', action: { in: actions as never[] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

describe('setShareDocumentAccessKey generate twice on one document', () => {
  async function run(hooks: ShareWorldHooks) {
    const { gate, slow, fast } = twoWorlds('setKey', 'before', hooks);
    const input = { shareLinkId: 'shr_a', documentId: 'doc_a', action: 'generate' as const };
    const results = await interleave(
      admin,
      gate,
      () => slow.setAccessKey.execute(owner, input),
      () => fast.setAccessKey.execute(owner, input),
    );
    return {
      results,
      row: await admin.shareLinkDocument.findUniqueOrThrow({
        where: { shareLinkId_documentId: { shareLinkId: 'shr_a', documentId: 'doc_a' } },
      }),
      log: await entries(['UPDATE']),
    };
  }

  function expectOneKey(outcome: Awaited<ReturnType<typeof run>>) {
    const [first, second] = outcome.results;
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
    // The stored key is the first caller's: the one clear key that was ever shown.
    const shown = (first as PromiseFulfilledResult<{ accessKey: string }>).value.accessKey;
    expect(outcome.row.accessKeyHash).toMatch(/^scrypt\$/);
    expect(outcome.log).toHaveLength(1);
    expect(shown).toHaveLength(19);
  }

  it('serializes on the ShareLink row: one key, one CONFLICT, one UPDATE entry', async () => {
    expectOneKey(await run({}));
  });

  it('control: with no lock and ReadCommitted both callers store a key and the first one is overwritten', async () => {
    const outcome = await run(UNLOCKED);
    expect(outcome.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(outcome.log).toHaveLength(2);
    expect(() => expectOneKey(outcome)).toThrow();
  });
});

describe('updateShareLink vs revokeShareLink', () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    id: 'shr_a',
    title: 'Editado',
    locale: 'es',
    message: null,
    clientId: null,
    allowDownload: true,
    expiresAt: null,
    documents: [{ documentId: 'doc_a', versionId: null, requiresAccessKey: false }],
    ...over,
  });

  /** The edit holds what it read (a live link) and pauses before its write; the revoke runs meanwhile. */
  async function editVsRevoke(hooks: ShareWorldHooks) {
    const { gate, slow, fast } = twoWorlds('update', 'before', hooks);
    const results = await interleave(
      admin,
      gate,
      () => slow.updateShareLink.execute(owner, edit()),
      () => fast.revokeShareLink.execute(owner, { id: 'shr_a' }),
    );
    return {
      results,
      row: await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } }),
      log: (await entries(['UPDATE', 'SHARE_REVOKE'])).map((entry) => entry.action),
    };
  }

  /** Revoke is final: no edit may be recorded after it. */
  function expectRevokeIsFinal(outcome: Awaited<ReturnType<typeof editVsRevoke>>) {
    expect(outcome.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(outcome.row.revokedAt).not.toBeNull();
    expect(outcome.log).toEqual(['UPDATE', 'SHARE_REVOKE']);
  }

  it('serialize on the ShareLink row: the edit goes first, then the revoke closes the link', async () => {
    const outcome = await editVsRevoke({});
    expectRevokeIsFinal(outcome);
    expect(outcome.row.title).toBe('Editado');
  });

  it('control: with no lock and ReadCommitted the edit lands on a link that was revoked meanwhile', async () => {
    const outcome = await editVsRevoke(UNLOCKED);
    expect(outcome.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(outcome.log).toEqual(['SHARE_REVOKE', 'UPDATE']);
    expect(outcome.row.title).toBe('Editado');
    expect(() => expectRevokeIsFinal(outcome)).toThrow();
  });

  it('a revoke that holds the lock wins: the edit behind it is INTEGRITY_LOCK and changes nothing', async () => {
    const { gate, slow, fast } = twoWorlds('revoke', 'before');
    const results = await interleave(
      admin,
      gate,
      () => slow.revokeShareLink.execute(owner, { id: 'shr_a' }),
      () => fast.updateShareLink.execute(owner, edit()),
    );
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'INTEGRITY_LOCK' });
    const row = await admin.shareLink.findUniqueOrThrow({ where: { id: 'shr_a' } });
    expect(row.revokedAt).not.toBeNull();
    expect(row.title).toBe('Enlace');
    expect(await entries(['UPDATE'])).toHaveLength(0);
  });
});

describe('two edits of the document list of one link', () => {
  const edit = (title: string, documentIds: string[]) => ({
    id: 'shr_a',
    title,
    locale: 'es',
    message: null,
    clientId: null,
    allowDownload: true,
    expiresAt: null,
    documents: documentIds.map((documentId) => ({
      documentId,
      versionId: null,
      requiresAccessKey: false,
    })),
  });

  async function run(hooks: ShareWorldHooks) {
    const { gate, slow, fast } = twoWorlds('replaceDocuments', 'after', hooks);
    const results = await interleave(
      admin,
      gate,
      () => slow.updateShareLink.execute(owner, edit('Lista AB', ['doc_a', 'doc_b'])),
      () => fast.updateShareLink.execute(owner, edit('Lista C', ['doc_c'])),
    );
    const documents = await admin.shareLinkDocument.findMany({
      where: { shareLinkId: 'shr_a' },
      orderBy: [{ order: 'asc' }, { documentId: 'asc' }],
    });
    return { results, ids: documents.map((row) => row.documentId) };
  }

  function expectNoMixedList(outcome: Awaited<ReturnType<typeof run>>) {
    expect(outcome.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    // The list is exactly one of the two forms, the one committed last: never a union of both.
    expect(outcome.ids).toEqual(['doc_c']);
  }

  it('serialize on the ShareLink row: the list is one form, the last committed', async () => {
    expectNoMixedList(await run({}));
  });

  it('control: with no lock and ReadCommitted the two forms mix into one list', async () => {
    const outcome = await run(UNLOCKED);
    // doc_b comes from the first form and doc_c from the second: neither form is the list.
    expect(outcome.ids).toEqual(expect.arrayContaining(['doc_b', 'doc_c']));
    expect(() => expectNoMixedList(outcome)).toThrow();
  });
});

describe('MarkExpiredShareLinks run twice at once', () => {
  beforeEach(async () => {
    for (const id of ['shr_x', 'shr_y']) {
      await admin.shareLink.create({
        data: {
          id,
          token: id.padEnd(43, 'x'),
          title: `Vencido ${id}`,
          expiresAt: new Date('2020-01-01'),
          createdById: owner.userId,
          documents: { create: [{ documentId: 'doc_a', order: 0 }] },
        },
      });
    }
  });

  const SYSTEM = { actorType: 'SYSTEM', userId: null } as const;

  async function run(hooks: ShareWorldHooks) {
    const { gate, slow, fast } = twoWorlds('markExpired', 'before', hooks);
    const results = await interleave(
      admin,
      gate,
      () => slow.markExpired.execute(SYSTEM),
      () => fast.markExpired.execute(SYSTEM),
    );
    return {
      results,
      log: await admin.activityLog.findMany({
        where: { entityType: 'SHARE_LINK', action: 'SYSTEM_JOB' },
        orderBy: [{ entityId: 'asc' }, { id: 'asc' }],
      }),
    };
  }

  function expectOneEntryPerLink(outcome: Awaited<ReturnType<typeof run>>) {
    expect(outcome.log.map((entry) => entry.entityId)).toEqual(['shr_x', 'shr_y']);
    const updated = outcome.results.map(
      (result) => (result as PromiseFulfilledResult<{ updated: number }>).value.updated,
    );
    expect(updated.reduce((sum, count) => sum + count, 0)).toBe(2);
  }

  it('serialize per link: every link is marked once and logged once', async () => {
    const outcome = await run({});
    expect(outcome.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expectOneEntryPerLink(outcome);
    const rows = await admin.shareLink.findMany({ where: { id: { in: ['shr_x', 'shr_y'] } } });
    expect(rows.every((row) => row.expiredAt !== null)).toBe(true);
  });

  it('control: with no lock and ReadCommitted both runs mark and log the link they both listed', async () => {
    const outcome = await run(UNLOCKED);
    expect(outcome.log.length).toBeGreaterThan(2);
    expect(() => expectOneEntryPerLink(outcome)).toThrow();
  });
});

describe('createShareLink never stores or logs a clear key', () => {
  it('keeps the hash only in the row and the clear key only in the result', async () => {
    const world = buildShareWorld(service);
    const { share, generatedKeys } = await world.createShareLink.execute(owner, {
      title: 'Con llave',
      documents: [{ documentId: 'doc_b', versionId: null, requiresAccessKey: true }],
    });
    const clear = must(generatedKeys[0]).accessKey;
    const row = await admin.shareLinkDocument.findFirstOrThrow({
      where: { shareLinkId: share.id },
    });
    expect(must(row.accessKeyHash).startsWith(KEY_HASH_PREFIX)).toBe(true);
    expect(row.accessKeyHash).not.toContain(clear);
    const log = await admin.activityLog.findMany({ where: { entityId: share.id } });
    expect(JSON.stringify(log)).not.toContain(clear);
    expect(JSON.stringify(log)).not.toContain(must(row.accessKeyHash));
    expect(JSON.stringify(share)).not.toContain(clear);
  });
});
