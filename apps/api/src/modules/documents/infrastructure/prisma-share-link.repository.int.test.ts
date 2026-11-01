import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { must } from '../../../../test/documents/shares/must';
import { seedClient } from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../shared/domain/list-query';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from '../../../shared/infrastructure/prisma/prisma-unit-of-work';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type {
  NewShareLink,
  ShareAccessLogCriteria,
  ShareDocumentWrite,
  ShareLinkListCriteria,
} from '../application/ports/share-link.repository.port';
import { PrismaShareLinkRepository } from './prisma-share-link.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const host = new TransactionHost(service);
const uow = new PrismaUnitOfWork(host);
const repository = new PrismaShareLinkRepository(host);

const T0 = new Date('2026-10-30T12:00:00.000Z');
const TODAY = '2026-10-30';
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const HASH = 'scrypt$16384$8$1$c2FsdA$aGFzaA';

let userId = '';

const newLink = (id: string, over: Partial<NewShareLink> = {}): NewShareLink => ({
  id,
  token: `T${id.padStart(42, '0')}`,
  title: `Enlace ${id}`,
  message: null,
  clientId: null,
  locale: 'es',
  allowDownload: true,
  expiresAt: null,
  createdAt: T0,
  createdById: userId,
  ...over,
});
const write = (
  documentId: string,
  order: number,
  key: ShareDocumentWrite['key'] = { kind: 'clear' },
  versionId: string | null = null,
): ShareDocumentWrite => ({ documentId, versionId, order, key });
const save = (link: NewShareLink, documents: ShareDocumentWrite[] = [write('doc_a', 0)]) =>
  uow.run(() => repository.insert(link, documents));

const listCriteria = (
  over: Partial<Omit<ShareLinkListCriteria, 'query'>> & { query?: Partial<ListQuery> } = {},
): ShareLinkListCriteria => {
  const { query, ...rest } = over;
  return {
    statuses: [],
    clientIds: [],
    documentId: null,
    hasAccessKeys: null,
    createdFrom: null,
    createdTo: null,
    today: TODAY,
    ...rest,
    query: { ...DEFAULT_LIST_QUERY, sort: { field: 'createdAt', direction: 'asc' }, ...query },
  };
};
const logCriteria = (
  over: Partial<Omit<ShareAccessLogCriteria, 'query'>> & { query?: Partial<ListQuery> } & Pick<
      ShareAccessLogCriteria,
      'shareLinkId'
    >,
): ShareAccessLogCriteria => {
  const { query, ...rest } = over;
  return {
    events: [],
    documentId: null,
    from: null,
    to: null,
    ...rest,
    query: { ...DEFAULT_LIST_QUERY, sort: { field: 'createdAt', direction: 'desc' }, ...query },
  };
};
const ids = (page: { items: { id: string }[] }) => page.items.map((row) => row.id);

beforeAll(async () => {
  await truncateBusinessTables(admin);
}, 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});
beforeEach(async () => {
  await truncateBusinessTables(admin);
  userId = (
    await admin.user.create({
      data: { clerkId: 'user_share', email: 'share@example.test', name: 'Autora', role: 'OWNER' },
    })
  ).id;
  for (const id of ['doc_a', 'doc_b', 'doc_c']) {
    await admin.document.create({
      data: {
        id,
        code: `DOC-${id}`,
        title: `Documento ${id}`,
        typeId: 'dtyp_nda',
        status: 'APROBADO',
        createdById: userId,
      },
    });
  }
  await admin.documentVersion.createMany({
    data: [
      {
        id: 'a_v1',
        documentId: 'doc_a',
        versionNumber: 1,
        format: 'MARKDOWN',
        content: '# 1',
        createdById: userId,
      },
      {
        id: 'a_v2',
        documentId: 'doc_a',
        versionNumber: 2,
        format: 'MARKDOWN',
        content: '# 2',
        createdById: userId,
      },
      {
        id: 'b_v1',
        documentId: 'doc_b',
        versionNumber: 1,
        format: 'ENLACE',
        url: 'https://x.test',
        createdById: userId,
      },
    ],
  });
  await admin.document.update({ where: { id: 'doc_a' }, data: { currentVersionId: 'a_v2' } });
  await admin.document.update({ where: { id: 'doc_b' }, data: { currentVersionId: 'b_v1' } });
}, 60_000);

describe('PrismaShareLinkRepository: rows', () => {
  it('round-trips a link, its date-only expiry and its documents without exposing a hash', async () => {
    await save(
      newLink('l1', {
        message: 'Hola',
        locale: 'en',
        allowDownload: false,
        expiresAt: '2026-12-31',
      }),
      [write('doc_b', 1), write('doc_a', 0, { kind: 'set', hash: HASH, updatedAt: at(1) }, 'a_v1')],
    );

    expect(await repository.findById('l1')).toEqual({
      id: 'l1',
      token: `T${'l1'.padStart(42, '0')}`,
      title: 'Enlace l1',
      message: 'Hola',
      clientId: null,
      locale: 'en',
      allowDownload: false,
      expiresAt: '2026-12-31',
      expiredAt: null,
      revokedAt: null,
      viewCount: 0,
      downloadCount: 0,
      lastAccessedAt: null,
      createdAt: T0,
      createdById: userId,
    });
    expect(must(await repository.findByToken(`T${'l1'.padStart(42, '0')}`)).id).toBe('l1');
    expect(await repository.findByToken('x'.repeat(43))).toBeNull();
    expect(await repository.findById('missing')).toBeNull();

    const documents = await repository.documentsOf('l1');
    expect(documents).toEqual([
      {
        shareLinkId: 'l1',
        documentId: 'doc_a',
        versionId: 'a_v1',
        order: 0,
        hasAccessKey: true,
        accessKeyUpdatedAt: at(1),
      },
      {
        shareLinkId: 'l1',
        documentId: 'doc_b',
        versionId: null,
        order: 1,
        hasAccessKey: false,
        accessKeyUpdatedAt: null,
      },
    ]);
    expect(JSON.stringify(documents)).not.toContain('scrypt');
    expect(await repository.accessKeyHashOf('l1', 'doc_a')).toBe(HASH);
    expect(await repository.accessKeyHashOf('l1', 'doc_b')).toBeNull();
    expect(await repository.accessKeyHashOf('l1', 'doc_c')).toBeNull();
  });

  it('rolls the insert back with the unit of work', async () => {
    await expect(
      uow.run(async () => {
        await repository.insert(newLink('l1'), [write('doc_a', 0)]);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await repository.findById('l1')).toBeNull();
  });

  it('updates the form fields and clears the expiry marker only when asked', async () => {
    await save(newLink('l1', { expiresAt: '2026-10-01' }));
    await uow.run(() => repository.markExpired('l1', at(5)));
    const patch = {
      title: 'Nuevo',
      message: 'm',
      clientId: null,
      locale: 'en' as const,
      allowDownload: false,
      expiresAt: '2026-10-01',
      clearExpiredAt: false,
    };
    await uow.run(() => repository.update('l1', patch));
    expect(await repository.findById('l1')).toMatchObject({
      title: 'Nuevo',
      locale: 'en',
      allowDownload: false,
      expiredAt: at(5),
    });
    await uow.run(() =>
      repository.update('l1', { ...patch, expiresAt: null, clearExpiredAt: true }),
    );
    expect(await repository.findById('l1')).toMatchObject({ expiresAt: null, expiredAt: null });
  });

  it('replaces the document list: drops, re-pins, reorders and keeps, clears or sets keys', async () => {
    await save(newLink('l1'), [
      write('doc_a', 0, { kind: 'set', hash: HASH, updatedAt: at(1) }),
      write('doc_b', 1, { kind: 'set', hash: `${HASH}b`, updatedAt: at(1) }),
    ]);

    await uow.run(() =>
      repository.replaceDocuments('l1', [
        write('doc_c', 0, { kind: 'set', hash: `${HASH}c`, updatedAt: at(2) }),
        write('doc_a', 1, { kind: 'keep' }, 'a_v1'),
      ]),
    );

    expect(await repository.documentsOf('l1')).toEqual([
      expect.objectContaining({
        documentId: 'doc_c',
        order: 0,
        hasAccessKey: true,
        accessKeyUpdatedAt: at(2),
      }),
      expect.objectContaining({
        documentId: 'doc_a',
        order: 1,
        versionId: 'a_v1',
        hasAccessKey: true,
        accessKeyUpdatedAt: at(1),
      }),
    ]);
    expect(await repository.accessKeyHashOf('l1', 'doc_a')).toBe(HASH);
    expect(await repository.accessKeyHashOf('l1', 'doc_b')).toBeNull();

    await uow.run(() => repository.replaceDocuments('l1', [write('doc_a', 0, { kind: 'clear' })]));
    expect(await repository.documentsOf('l1')).toEqual([
      expect.objectContaining({
        documentId: 'doc_a',
        hasAccessKey: false,
        accessKeyUpdatedAt: null,
      }),
    ]);
  });

  it('sets, regenerates and clears one key', async () => {
    await save(newLink('l1'));
    await uow.run(() => repository.setKey('l1', 'doc_a', { hash: HASH, updatedAt: at(3) }));
    expect(await repository.accessKeyHashOf('l1', 'doc_a')).toBe(HASH);
    await uow.run(() => repository.setKey('l1', 'doc_a', { hash: `${HASH}2`, updatedAt: at(4) }));
    expect(await repository.documentsOf('l1')).toEqual([
      expect.objectContaining({ hasAccessKey: true, accessKeyUpdatedAt: at(4) }),
    ]);
    await uow.run(() => repository.setKey('l1', 'doc_a', null));
    expect(await repository.accessKeyHashOf('l1', 'doc_a')).toBeNull();
  });

  it('revokes and lists only the expired, unrevoked, unmarked links for the step', async () => {
    await save(newLink('past', { expiresAt: '2026-10-20' }));
    await save(newLink('today', { expiresAt: '2026-10-30' }));
    await save(newLink('never'));
    await save(newLink('revoked', { expiresAt: '2026-10-01' }));
    await save(newLink('marked', { expiresAt: '2026-10-01' }));
    await uow.run(() => repository.revoke('revoked', at(1)));
    await uow.run(() => repository.markExpired('marked', at(2)));

    expect(must(await repository.findById('revoked')).revokedAt).toEqual(at(1));
    expect(await repository.expiredIds(TODAY)).toEqual(['past']);
    expect(await repository.expiredIds('2026-10-31')).toEqual(['past', 'today']);
  });

  it('reads documents with their archive flag and the owner document of each version', async () => {
    await admin.document.update({ where: { id: 'doc_c' }, data: { deletedAt: at(0) } });
    const found = await repository.sharableDocuments(['doc_a', 'doc_c', 'missing']);
    expect([...found.keys()].sort()).toEqual(['doc_a', 'doc_c']);
    expect(found.get('doc_a')).toEqual({
      id: 'doc_a',
      code: 'DOC-doc_a',
      title: 'Documento doc_a',
      status: 'APROBADO',
      currentVersionId: 'a_v2',
      archived: false,
    });
    expect(found.get('doc_c')).toMatchObject({ archived: true, currentVersionId: null });
    expect(await repository.sharableDocuments([])).toEqual(new Map());

    expect(await repository.versionOwners(['a_v1', 'b_v1', 'nope'])).toEqual(
      new Map([
        ['a_v1', 'doc_a'],
        ['b_v1', 'doc_b'],
      ]),
    );
    expect(await repository.versionOwners([])).toEqual(new Map());
  });
});

describe('PrismaShareLinkRepository: list', () => {
  beforeEach(async () => {
    await seedClient(admin as never, 'cli_k');
    await seedClient(admin as never, 'cli_s');
    await admin.client.update({ where: { id: 'cli_k' }, data: { tradeName: 'Kairós' } });
    await save(newLink('l1', { title: 'Alfa', clientId: 'cli_k', createdAt: at(0) }), [
      write('doc_a', 0, { kind: 'set', hash: HASH, updatedAt: at(0) }),
      write('doc_b', 1),
    ]);
    await save(
      newLink('l2', {
        title: 'Beta',
        clientId: 'cli_s',
        expiresAt: '2026-10-15',
        createdAt: at(1),
      }),
      [write('doc_b', 0)],
    );
    await save(newLink('l3', { title: 'Gamma', createdAt: new Date('2026-10-31T02:00:00.000Z') }), [
      write('doc_c', 0),
    ]);
    await uow.run(() => repository.revoke('l3', at(10)));
    await admin.shareLink.update({
      where: { id: 'l2' },
      data: { viewCount: 5, downloadCount: 1, lastAccessedAt: at(30) },
    });
  });

  it('pages in SQL, newest first by default and by the whitelisted sorts', async () => {
    expect(ids(await repository.list(listCriteria()))).toEqual(['l1', 'l2', 'l3']);
    expect(
      ids(
        await repository.list(
          listCriteria({ query: { sort: { field: 'createdAt', direction: 'desc' } } }),
        ),
      ),
    ).toEqual(['l3', 'l2', 'l1']);
    expect(
      ids(
        await repository.list(
          listCriteria({ query: { sort: { field: 'title', direction: 'desc' } } }),
        ),
      ),
    ).toEqual(['l3', 'l2', 'l1']);
    expect(
      ids(
        await repository.list(
          listCriteria({ query: { sort: { field: 'viewCount', direction: 'desc' } } }),
        ),
      )[0],
    ).toBe('l2');
    expect(
      ids(
        await repository.list(
          listCriteria({ query: { sort: { field: 'lastAccessedAt', direction: 'desc' } } }),
        ),
      ),
    ).toEqual(['l2', 'l1', 'l3']);
    expect(
      ids(
        await repository.list(
          listCriteria({ query: { sort: { field: 'expiresAt', direction: 'asc' } } }),
        ),
      ),
    ).toEqual(['l2', 'l1', 'l3']);
    expect(
      ids(
        await repository.list(
          listCriteria({ query: { sort: { field: 'status', direction: 'asc' } } }),
        ),
      ),
    ).toEqual(['l1', 'l2', 'l3']);
    const paged = await repository.list(listCriteria({ query: { pageSize: 25, page: 2 } }));
    expect(paged).toMatchObject({ items: [], total: 3, page: 2 });
    await expect(
      repository.list(listCriteria({ query: { sort: { field: 'nope', direction: 'asc' } } })),
    ).rejects.toThrow(/Sort field/);
  });

  it('derives the status from revokedAt, expiresAt and the Caracas day', async () => {
    expect(ids(await repository.list(listCriteria({ statuses: ['ACTIVE'] })))).toEqual(['l1']);
    expect(ids(await repository.list(listCriteria({ statuses: ['EXPIRED'] })))).toEqual(['l2']);
    expect(ids(await repository.list(listCriteria({ statuses: ['REVOKED', 'EXPIRED'] })))).toEqual([
      'l2',
      'l3',
    ]);
    // The last valid day is still ACTIVE.
    expect(
      ids(await repository.list(listCriteria({ statuses: ['ACTIVE'], today: '2026-10-15' }))),
    ).toEqual(['l1', 'l2']);
  });

  it('filters by client, document, key protection and Caracas creation day', async () => {
    expect(ids(await repository.list(listCriteria({ clientIds: ['cli_s'] })))).toEqual(['l2']);
    expect(ids(await repository.list(listCriteria({ documentId: 'doc_b' })))).toEqual(['l1', 'l2']);
    expect(ids(await repository.list(listCriteria({ hasAccessKeys: true })))).toEqual(['l1']);
    expect(ids(await repository.list(listCriteria({ hasAccessKeys: false })))).toEqual([
      'l2',
      'l3',
    ]);
    // l3 was created at 02:00Z on the 31st: still the 30th in Caracas (UTC-4).
    expect(
      ids(
        await repository.list(listCriteria({ createdFrom: '2026-10-30', createdTo: '2026-10-30' })),
      ),
    ).toEqual(['l1', 'l2', 'l3']);
    expect(ids(await repository.list(listCriteria({ createdFrom: '2026-10-31' })))).toEqual([]);
  });

  it('searches the title and the client label, ignoring accents and LIKE wildcards', async () => {
    expect(ids(await repository.list(listCriteria({ query: { q: 'alf' } })))).toEqual(['l1']);
    expect(ids(await repository.list(listCriteria({ query: { q: 'KAIROS' } })))).toEqual(['l1']);
    expect(ids(await repository.list(listCriteria({ query: { q: 'cli_s' } })))).toEqual(['l2']);
    expect(ids(await repository.list(listCriteria({ query: { q: '%' } })))).toEqual([]);
    const paged = await repository.list(listCriteria({ query: { q: 'a' } }));
    expect(paged.total).toBe(3);
  });
});

describe('PrismaShareLinkRepository: relations and access log', () => {
  const log = (
    id: string,
    shareLinkId: string,
    event: 'VIEW' | 'DOWNLOAD' | 'UNLOCK' | 'UNLOCK_FAILED',
    documentId: string | null,
    createdAt: Date,
    ipHash = 'a'.repeat(64),
  ) =>
    admin.shareAccessLog.create({
      data: { id, shareLinkId, event, documentId, ipHash, userAgent: 'UA', createdAt },
    });

  beforeEach(async () => {
    await save(newLink('l1'), [
      write('doc_a', 0, { kind: 'set', hash: HASH, updatedAt: at(1) }),
      write('doc_b', 1, { kind: 'clear' }, 'b_v1'),
    ]);
    await save(newLink('l2'), [write('doc_a', 0, { kind: 'clear' }, 'a_v1')]);
  });

  it('assembles documents with the served version, key flag, counters and author', async () => {
    await log('g1', 'l1', 'VIEW', null, at(1));
    await log('g2', 'l1', 'VIEW', 'doc_a', at(2));
    await log('g3', 'l1', 'UNLOCK_FAILED', 'doc_a', at(3));
    await log('g4', 'l1', 'UNLOCK_FAILED', 'doc_a', at(4));
    await log('g5', 'l1', 'UNLOCK', 'doc_a', at(5));
    await log('g6', 'l1', 'DOWNLOAD', 'doc_b', at(6));
    await log('g7', 'l2', 'VIEW', 'doc_a', at(7));

    const relations = await repository.relationsOf(['l1', 'l2', 'missing']);
    expect([...relations.keys()].sort()).toEqual(['l1', 'l2']);

    const one = must(relations.get('l1'));
    expect(one.createdBy).toEqual({ id: userId, name: 'Autora', imageUrl: null });
    expect(one).toMatchObject({ unlockCount: 1, failedUnlockCount: 2 });
    expect(one.documents.map((doc) => doc.document.id)).toEqual(['doc_a', 'doc_b']);
    expect(one.documents[0]).toMatchObject({
      hasAccessKey: true,
      served: { id: 'a_v2', versionNumber: 2, format: 'MARKDOWN' },
      counters: { viewCount: 1, downloadCount: 0, unlockCount: 1, failedUnlockCount: 2 },
    });
    expect(one.documents[1]).toMatchObject({
      hasAccessKey: false,
      versionId: 'b_v1',
      served: { id: 'b_v1', versionNumber: 1, format: 'ENLACE' },
      counters: { viewCount: 0, downloadCount: 1, unlockCount: 0, failedUnlockCount: 0 },
    });
    // A pinned document serves its pinned version, and another link's log never leaks in.
    expect(must(relations.get('l2')).documents[0]).toMatchObject({
      served: { id: 'a_v1', versionNumber: 1 },
      counters: { viewCount: 1 },
    });
    expect(relations.get('l2')).toMatchObject({ unlockCount: 0, failedUnlockCount: 0 });
    expect(JSON.stringify(relations.get('l1'))).not.toContain('scrypt');
    expect(await repository.relationsOf([])).toEqual(new Map());
  });

  it('keeps an archived document in the relations, flagged', async () => {
    await admin.document.update({ where: { id: 'doc_b' }, data: { deletedAt: at(0) } });
    const one = must((await repository.relationsOf(['l1'])).get('l1'));
    expect(one.documents.map((doc) => [doc.document.id, doc.document.archived])).toEqual([
      ['doc_a', false],
      ['doc_b', true],
    ]);
  });

  it('lists the access log with a 12-character visitor, the title and the filters', async () => {
    await log('x1', 'l1', 'VIEW', null, new Date('2026-10-29T03:00:00.000Z'), 'ab'.repeat(32));
    await log('x2', 'l1', 'VIEW', 'doc_a', new Date('2026-10-29T05:00:00.000Z'));
    await log('x3', 'l1', 'UNLOCK_FAILED', 'doc_a', new Date('2026-10-30T10:00:00.000Z'));
    await log('x4', 'l1', 'DOWNLOAD', 'doc_b', new Date('2026-10-31T01:00:00.000Z'));
    await log('x5', 'l2', 'VIEW', null, new Date('2026-10-30T10:00:00.000Z'));

    const all = await repository.listAccessLog(logCriteria({ shareLinkId: 'l1' }));
    expect(ids(all)).toEqual(['x4', 'x3', 'x2', 'x1']);
    expect(all.total).toBe(4);
    expect(all.items[3]).toEqual({
      id: 'x1',
      shareLinkId: 'l1',
      event: 'VIEW',
      documentId: null,
      documentTitle: null,
      visitor: 'abababababab',
      userAgent: 'UA',
      createdAt: new Date('2026-10-29T03:00:00.000Z'),
    });
    expect(all.items[0]).toMatchObject({
      documentTitle: 'Documento doc_b',
      visitor: 'a'.repeat(12),
    });
    expect(JSON.stringify(all)).not.toContain('a'.repeat(13));

    const ofLink = async (over: Partial<ShareAccessLogCriteria>) =>
      ids(await repository.listAccessLog({ ...logCriteria({ shareLinkId: 'l1' }), ...over }));
    expect(await ofLink({ events: ['VIEW'] })).toEqual(['x2', 'x1']);
    expect(await ofLink({ documentId: 'doc_a' })).toEqual(['x3', 'x2']);
    // x1 (03:00Z) is still the 28th in Caracas; x4 (01:00Z on the 31st) is still the 30th.
    expect(await ofLink({ from: '2026-10-29', to: '2026-10-30' })).toEqual(['x4', 'x3', 'x2']);
    expect(await ofLink({ to: '2026-10-28' })).toEqual(['x1']);
    expect(
      ids(
        await repository.listAccessLog(
          logCriteria({ shareLinkId: 'l1', query: { sort: { field: 'event', direction: 'asc' } } }),
        ),
      ),
    ).toEqual(['x4', 'x3', 'x1', 'x2']);
    expect(
      ids(
        await repository.listAccessLog(
          logCriteria({ shareLinkId: 'l1', query: { sort: null, pageSize: 25 } }),
        ),
      ),
    ).toHaveLength(4);
  });
});
