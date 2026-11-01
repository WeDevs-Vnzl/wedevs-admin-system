import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import {
  buildDocumentWorld,
  Gate,
  gated,
  interleave,
  noLocks,
  readCommitted,
  type DocumentWorldHooks,
} from './world';

/**
 * Concurrent document mutations over real PostgreSQL (lessons B3, M1; DT-126, DT-146). The first transaction is
 * paused once it holds what it read (the `Document` row lock) and before its write; the second one then runs.
 * With the row lock and `Serializable` the second waits and reads the committed state; without them it works on a
 * stale read and the two commits disagree (a status change on a document that was archived meanwhile).
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

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_doc_conc', email: 'conc@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  await admin.client.create({
    data: {
      id: 'cli_a',
      code: 'CLI-0001',
      kind: 'EMPRESA',
      tradeName: 'Kairos',
      legalName: 'Kairos C.A.',
      taxId: 'J-1',
      country: 'VE',
      address: 'Av. Principal',
      phone: '+584121234567',
      metrics: { create: {} },
    },
  });
  await admin.document.create({
    data: {
      id: 'doc_a',
      code: 'DOC-0001',
      title: 'NDA',
      typeId: 'dtyp_nda',
      createdById: owner.userId,
      links: { create: [{ clientId: 'cli_a' }] },
    },
  });
}, 60_000);

/** The unlocked behavior, applied to the world under test as well as to the one racing it. */
const UNLOCKED: DocumentWorldHooks = { locks: noLocks, uow: readCommitted };

/**
 * Two worlds, the first one paused right before it writes through the repository method `pauseOn`: it then
 * holds whatever the use case locked, and the second one either waits for it (lock) or runs on a stale read.
 */
function twoWorlds(pauseOn: string, hooks: DocumentWorldHooks = {}) {
  const gate = new Gate();
  const slow = buildDocumentWorld(service, {
    ...hooks,
    documents: (repository) => gated(repository, gate, [pauseOn], 'before'),
  });
  const fast = buildDocumentWorld(service, hooks);
  return { gate, slow, fast };
}

async function statusVsArchive(hooks: DocumentWorldHooks) {
  const { gate, slow, fast } = twoWorlds('setStatus', hooks);
  const results = await interleave(
    admin,
    gate,
    () => slow.setStatus.execute(owner, { id: 'doc_a', status: 'EN_REVISION' }),
    () => fast.archiveDocument.execute(owner, { id: 'doc_a' }),
  );
  const log = await admin.activityLog.findMany({
    where: {
      entityType: 'DOCUMENT',
      entityId: 'doc_a',
      action: { in: ['STATUS_CHANGE', 'DELETE'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return {
    results,
    log,
    row: await admin.document.findUniqueOrThrow({ where: { id: 'doc_a' } }),
    entry: await admin.searchEntry.findFirst({
      where: { entityType: 'DOCUMENT', entityId: 'doc_a' },
    }),
  };
}

/** What must hold whichever transaction won the lock: no status change lands on an archived document. */
function expectCoherent(outcome: Awaited<ReturnType<typeof statusVsArchive>>) {
  const [status, archive] = outcome.results;
  expect(archive.status).toBe('fulfilled');
  expect(outcome.row.deletedAt).not.toBeNull();
  if (status.status === 'rejected') {
    // The archive committed first: the status change found no live document.
    expect(status.reason).toMatchObject({ code: 'NOT_FOUND' });
    expect(outcome.row.status).toBe('BORRADOR');
    expect(outcome.log.map((entry) => entry.action)).toEqual(['DELETE']);
    return;
  }
  // The status change committed first and the archive then saw it: the log reads in that order.
  expect(outcome.log.map((entry) => entry.action)).toEqual(['STATUS_CHANGE', 'DELETE']);
  expect(outcome.row.status).toBe('EN_REVISION');
  expect(outcome.entry).toMatchObject({ status: 'EN_REVISION', archived: true });
}

describe('setDocumentStatus vs archiveDocument of one document', () => {
  it('serialize on the Document row: the second one reads what the first committed', async () => {
    expectCoherent(await statusVsArchive({}));
  });

  it('control: with no lock and ReadCommitted the same interleaving puts a status change on an archived document', async () => {
    const outcome = await statusVsArchive(UNLOCKED);
    expect(outcome.results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(outcome.row.deletedAt).not.toBeNull();
    // The status change wrote after the archive: its entry comes after DELETE, on a document that was archived.
    expect(outcome.log.map((entry) => entry.action)).toEqual(['DELETE', 'STATUS_CHANGE']);
    expect(() => expectCoherent(outcome)).toThrow();
  });
});

describe('linkDocument twice with the same target', () => {
  const target = { entityType: 'CONTACT' as const, entityId: 'con_a' };

  beforeEach(async () => {
    await admin.contact.create({ data: { id: 'con_a', clientId: 'cli_a', fullName: 'Ana Pérez' } });
  });

  it('leaves one link row, one LINK entry and no error for either caller', async () => {
    const { gate, slow, fast } = twoWorlds('addLink');

    const results = await interleave(
      admin,
      gate,
      () => slow.linkDocument.execute(owner, { documentId: 'doc_a', target }),
      () => fast.linkDocument.execute(owner, { documentId: 'doc_a', target }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(
      await admin.documentLink.count({ where: { documentId: 'doc_a', contactId: 'con_a' } }),
    ).toBe(1);
    expect(await admin.activityLog.count({ where: { entityId: 'doc_a', action: 'LINK' } })).toBe(1);
    for (const result of results) {
      const links = (result as PromiseFulfilledResult<{ entity: { id: string } }[]>).value;
      expect(links.map((link) => link.entity.id).sort()).toEqual(['cli_a', 'con_a']);
    }
  });

  it('control: with no lock and ReadCommitted the repeated insert still writes one row (ON CONFLICT DO NOTHING)', async () => {
    const { gate, slow, fast } = twoWorlds('addLink', UNLOCKED);

    const results = await interleave(
      admin,
      gate,
      () => slow.linkDocument.execute(owner, { documentId: 'doc_a', target }),
      () => fast.linkDocument.execute(owner, { documentId: 'doc_a', target }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(
      await admin.documentLink.count({ where: { documentId: 'doc_a', contactId: 'con_a' } }),
    ).toBe(1);
  });
});

describe('MarkExpiredDocuments vs archiveDocument', () => {
  it('serialize: an archived document is not marked VENCIDO on the stale candidate list', async () => {
    await admin.document.update({
      where: { id: 'doc_a' },
      data: { expiresAt: new Date('2026-01-01') },
    });
    const { gate, slow, fast } = twoWorlds('setStatus');

    const results = await interleave(
      admin,
      gate,
      () => slow.markExpired.execute({ actorType: 'SYSTEM', userId: null }),
      () => fast.archiveDocument.execute(owner, { id: 'doc_a' }),
    );

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const row = await admin.document.findUniqueOrThrow({ where: { id: 'doc_a' } });
    expect(row.deletedAt).not.toBeNull();
    // The step marked it first (the lock was its), then the archive saw VENCIDO: both are in the log, in order.
    expect(row.status).toBe('VENCIDO');
    const log = await admin.activityLog.findMany({
      where: { entityId: 'doc_a', action: { in: ['SYSTEM_JOB', 'DELETE'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(log.map((entry) => entry.action)).toEqual(['SYSTEM_JOB', 'DELETE']);
  });
});
