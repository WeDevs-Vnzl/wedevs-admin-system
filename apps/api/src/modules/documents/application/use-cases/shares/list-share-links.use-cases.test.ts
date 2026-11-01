import { describe, expect, it } from 'vitest';
import { must } from '../../../../../../test/documents/shares/must';
import {
  admin,
  form,
  member,
  owner,
  query,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/shares/world';

const DOC_A = { documentId: 'doc_a', versionId: null, order: 0, key: { kind: 'clear' } } as const;

/** Three links: an active keyed one of Kairos, an expired one of Solaris, a revoked one. */
async function listed() {
  const world = seededWorld();
  world.addClient('cli_solaris', 'Solaris');
  world.clock.set('2026-10-01T12:00:00.000Z');
  const first = await world.createShareLink.execute(
    owner,
    form({
      title: 'Alfa',
      clientId: 'cli_kairos',
      documents: [{ documentId: 'doc_a', requiresAccessKey: true }, { documentId: 'doc_b' }],
    }),
  );
  world.clock.set('2026-10-10T12:00:00.000Z');
  const second = await world.createShareLink.execute(
    owner,
    form({
      title: 'Beta',
      clientId: 'cli_solaris',
      expiresAt: '2026-10-15',
      documents: [{ documentId: 'doc_b' }],
    }),
  );
  world.clock.set('2026-10-20T12:00:00.000Z');
  const third = await world.createShareLink.execute(owner, form({ title: 'Gamma' }));
  await world.revokeShareLink.execute(owner, { id: third.share.id });
  world.clock.set('2026-10-30T12:00:00.000Z');
  return { world, first: first.share, second: second.share, third: third.share };
}

const titles = (page: { items: { title: string }[] }) => page.items.map((row) => row.title);

describe('listShareLinks', () => {
  it('lists newest first by default with status, counts and no key', async () => {
    const { world, first } = await listed();
    const page = await world.listShareLinks.execute(owner, query());
    expect(titles(page)).toEqual(['Gamma', 'Beta', 'Alfa']);
    expect(page).toMatchObject({ total: 3, page: 1, pageCount: 1 });
    expect(page.items.map((row) => row.status)).toEqual(['REVOKED', 'EXPIRED', 'ACTIVE']);
    const alfa = must(page.items.find((row) => row.id === first.id));
    expect(alfa).toMatchObject({
      documentCount: 2,
      protectedDocumentCount: 1,
      client: { id: 'cli_kairos', label: 'Kairos' },
      counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
      lastAccessedAt: null,
      createdBy: { id: owner.userId },
    });
    expect(JSON.stringify(page)).not.toMatch(/hash|accessKey"/);
  });

  it.each([
    [{ status: 'ACTIVE' }, ['Alfa']],
    [{ status: ['EXPIRED', 'REVOKED'] }, ['Gamma', 'Beta']],
    [{ clientId: 'cli_solaris' }, ['Beta']],
    [{ documentId: 'doc_a' }, ['Gamma', 'Alfa']],
    [{ hasAccessKeys: 'true' }, ['Alfa']],
    [{ hasAccessKeys: 'false' }, ['Gamma', 'Beta']],
    [{ createdFrom: '2026-10-10', createdTo: '2026-10-10' }, ['Beta']],
    [{ createdFrom: '2026-10-11' }, ['Gamma']],
  ])('filters by %j', async (filters, expected) => {
    const { world } = await listed();
    const page = await world.listShareLinks.execute(
      owner,
      query({ filters: filters as Record<string, string | string[]> }),
    );
    expect(titles(page)).toEqual(expected);
  });

  it('searches the title and the client label, and sorts by the whitelisted fields', async () => {
    const { world } = await listed();
    expect(titles(await world.listShareLinks.execute(owner, query({ q: 'solaris' })))).toEqual([
      'Beta',
    ]);
    expect(titles(await world.listShareLinks.execute(owner, query({ q: 'alf' })))).toEqual([
      'Alfa',
    ]);
    expect(
      titles(
        await world.listShareLinks.execute(
          owner,
          query({ sort: { field: 'title', direction: 'asc' } }),
        ),
      ),
    ).toEqual(['Alfa', 'Beta', 'Gamma']);
  });

  it.each([
    [{ status: 'DELETED' }, 'status'],
    [{ hasAccessKeys: 'maybe' }, 'hasAccessKeys'],
    [{ createdFrom: '2026-02-31' }, 'createdFrom'],
    [{ createdTo: 'soon' }, 'createdTo'],
  ])('rejects %j as VALIDATION on %s', async (filters, field) => {
    const { world } = await listed();
    await expect(
      world.listShareLinks.execute(owner, query({ filters: filters as Record<string, string> })),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { [field]: expect.any(Array) } });
  });

  it('is FORBIDDEN for member and viewer and open to admin', async () => {
    const { world } = await listed();
    for (const user of [member, viewer]) {
      await expect(world.listShareLinks.execute(user, query())).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    await expect(world.listShareLinks.execute(admin, query())).resolves.toHaveProperty('total', 3);
  });
});

describe('getShareLink', () => {
  it('derives status on the Caracas business day, not on UTC', async () => {
    const { world, second } = await listed();
    // Beta is valid through 2026-10-15 (Caracas); 2026-10-16T02:00Z is still the 15th there.
    world.clock.set('2026-10-16T02:00:00.000Z');
    expect((await world.getShareLink.execute(owner, { id: second.id })).status).toBe('ACTIVE');
    world.clock.set('2026-10-16T04:00:00.000Z');
    expect((await world.getShareLink.execute(owner, { id: second.id })).status).toBe('EXPIRED');
  });

  it('shows the pinned and the latest version of each document (HU-22 CA6)', async () => {
    const { world } = await listed();
    const { share } = await world.createShareLink.execute(
      owner,
      form({
        documents: [
          { documentId: 'doc_a', versionId: 'doc_a_v1' },
          { documentId: 'doc_b', versionId: null },
        ],
      }),
    );
    world.seedDocument('doc_b', { versions: 2 });
    const detail = await world.getShareLink.execute(owner, { id: share.id });
    expect(detail.documents.map((doc) => [doc.versionNumber, doc.isLatest])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('derives per-document counters, unlocks and failed unlocks from the log', async () => {
    const { world, first } = await listed();
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 29, 10, minutes));
    const log = (
      event: 'VIEW' | 'DOWNLOAD' | 'UNLOCK' | 'UNLOCK_FAILED',
      documentId: string | null,
      minutes: number,
    ) =>
      world.shares.logs.push({
        id: `log_${world.shares.logs.length}`,
        shareLinkId: first.id,
        event,
        documentId,
        ipHash: 'a'.repeat(64),
        userAgent: 'UA',
        createdAt: at(minutes),
      });
    log('VIEW', null, 1);
    log('VIEW', 'doc_a', 2);
    log('UNLOCK_FAILED', 'doc_a', 3);
    log('UNLOCK', 'doc_a', 4);
    log('DOWNLOAD', 'doc_a', 5);
    const detail = await world.getShareLink.execute(owner, { id: first.id });
    expect(must(detail.documents[0]).counters).toEqual({
      viewCount: 1,
      downloadCount: 1,
      unlockCount: 1,
      failedUnlockCount: 1,
    });
    expect(must(detail.documents[1]).counters).toEqual({
      viewCount: 0,
      downloadCount: 0,
      unlockCount: 0,
      failedUnlockCount: 0,
    });
    // View and download totals are the stored counters (written by the portal); unlocks come from the log.
    expect(detail.counters).toMatchObject({ unlockCount: 1, failedUnlockCount: 1 });
  });

  it('shows the stored counters and last access written by the portal', async () => {
    const world = seededWorld();
    world.seedLink(
      {
        id: 'busy',
        viewCount: 7,
        downloadCount: 3,
        lastAccessedAt: new Date('2026-10-29T10:00:00Z'),
      },
      [DOC_A],
    );
    const detail = await world.getShareLink.execute(owner, { id: 'busy' });
    expect(detail).toMatchObject({
      counters: { viewCount: 7, downloadCount: 3 },
      lastAccessedAt: new Date('2026-10-29T10:00:00Z'),
    });
  });

  it('is NOT_FOUND for an unknown link and FORBIDDEN for member and viewer', async () => {
    const { world, first } = await listed();
    await expect(world.getShareLink.execute(owner, { id: 'shr_x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const user of [member, viewer]) {
      await expect(world.getShareLink.execute(user, { id: first.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
  });
});

describe('listShareAccessLog', () => {
  async function withLog() {
    const { world, first } = await listed();
    const rows: [string, 'VIEW' | 'DOWNLOAD' | 'UNLOCK_FAILED', string | null, number][] = [
      ['one', 'VIEW', null, 1],
      ['two', 'VIEW', 'doc_a', 2],
      ['three', 'UNLOCK_FAILED', 'doc_a', 3],
      ['four', 'DOWNLOAD', 'doc_b', 4],
    ];
    for (const [id, event, documentId, day] of rows) {
      world.shares.logs.push({
        id,
        shareLinkId: first.id,
        event,
        documentId,
        ipHash: `${'f'.repeat(30)}${'0'.repeat(34)}`,
        userAgent: 'Mozilla',
        createdAt: new Date(Date.UTC(2026, 9, day, 15)),
      });
    }
    world.shares.logs.push({
      id: 'other',
      shareLinkId: 'someone_else',
      event: 'VIEW',
      documentId: null,
      ipHash: 'e'.repeat(64),
      userAgent: null,
      createdAt: new Date(),
    });
    return { world, first };
  }

  it('lists the log newest first with a 12-character visitor and the document title, never the hash', async () => {
    const { world, first } = await withLog();
    const page = await world.listAccessLog.execute(owner, {
      shareLinkId: first.id,
      query: query(),
    });
    expect(page.items.map((row) => row.id)).toEqual(['four', 'three', 'two', 'one']);
    expect(page.items[0]).toMatchObject({
      event: 'DOWNLOAD',
      documentId: 'doc_b',
      documentTitle: 'Documento doc_b',
      visitor: 'ffffffffffff',
      userAgent: 'Mozilla',
    });
    expect(must(page.items[0]).visitor).toHaveLength(12);
    expect(must(page.items[3]).documentTitle).toBeNull();
    expect(JSON.stringify(page)).not.toContain('f'.repeat(13));
  });

  it('filters by event, document and Caracas day range', async () => {
    const { world, first } = await withLog();
    const ids = async (filters: Record<string, string | string[]>) =>
      (
        await world.listAccessLog.execute(owner, {
          shareLinkId: first.id,
          query: query({ filters }),
        })
      ).items.map((row) => row.id);
    expect(await ids({ event: ['VIEW', 'DOWNLOAD'] })).toEqual(['four', 'two', 'one']);
    expect(await ids({ documentId: 'doc_a' })).toEqual(['three', 'two']);
    expect(await ids({ from: '2026-10-02', to: '2026-10-03' })).toEqual(['three', 'two']);
  });

  it('is VALIDATION for a bad facet, NOT_FOUND for an unknown link and FORBIDDEN below Admin', async () => {
    const { world, first } = await withLog();
    await expect(
      world.listAccessLog.execute(owner, {
        shareLinkId: first.id,
        query: query({ filters: { event: 'LOGIN', from: 'x' } }),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { event: expect.any(Array), from: expect.any(Array) },
    });
    await expect(
      world.listAccessLog.execute(owner, { shareLinkId: 'shr_x', query: query() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const user of [member, viewer]) {
      await expect(
        world.listAccessLog.execute(user, { shareLinkId: first.id, query: query() }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
