import { describe, expect, it } from 'vitest';
import { must } from '../../../../../../test/documents/shares/must';
import {
  admin,
  form,
  member,
  owner,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/shares/world';
import type { ShareLinkDetail } from './share-support';

/** The edit form as the FE submits it: every field of the link. */
function editOf(share: ShareLinkDetail, over: Record<string, unknown> = {}) {
  return {
    id: share.id,
    title: share.title,
    message: share.message,
    clientId: share.client?.id ?? null,
    locale: share.locale,
    allowDownload: share.allowDownload,
    expiresAt: share.expiresAt,
    documents: share.documents.map((doc) => ({
      documentId: doc.document.id,
      versionId: doc.versionId,
      requiresAccessKey: doc.requiresAccessKey,
    })),
    ...over,
  };
}

async function keyedLink() {
  const world = seededWorld();
  world.seedDocument('doc_c');
  const created = await world.createShareLink.execute(
    owner,
    form({
      documents: [{ documentId: 'doc_a', requiresAccessKey: true }, { documentId: 'doc_b' }],
    }),
  );
  return { world, created };
}

describe('updateShareLink (A5, A6)', () => {
  it('updates the fields of the edit form, keeps the token and logs the diff', async () => {
    const { world, created } = await keyedLink();
    const before = world.activity.entries.length;
    const { share, generatedKeys } = await world.updateShareLink.execute(
      owner,
      editOf(created.share, {
        title: 'Entrega final',
        locale: 'en',
        allowDownload: false,
        expiresAt: '2026-12-31',
        message: 'Nuevo mensaje largo',
      }),
    );

    expect(generatedKeys).toEqual([]);
    expect(share).toMatchObject({
      title: 'Entrega final',
      locale: 'en',
      allowDownload: false,
      expiresAt: '2026-12-31',
      token: created.share.token,
    });
    const entry = must(world.activity.entries[before]);
    expect(entry).toMatchObject({
      action: 'UPDATE',
      entityType: 'SHARE_LINK',
      entityId: created.share.id,
      entityLabel: 'Entrega final',
      changes: {
        title: ['Propuesta Kairos', 'Entrega final'],
        locale: ['es', 'en'],
        allowDownload: [true, false],
        expiresAt: [null, '2026-12-31'],
        message: 'changed',
      },
    });
    expect(Object.keys(must(entry.changes))).not.toContain('accessKey');
  });

  it('writes nothing in the log when the form changes nothing', async () => {
    const { world, created } = await keyedLink();
    const before = world.activity.entries.length;
    await world.updateShareLink.execute(owner, editOf(created.share));
    expect(world.activity.entries).toHaveLength(before);
  });

  it('keeps, generates and removes keys when the edit form replaces the documents', async () => {
    const { world, created } = await keyedLink();
    const keptHash = must(
      world.shares.storedDocuments(created.share.id).find((row) => row.documentId === 'doc_a'),
    ).accessKeyHash;

    // doc_a keeps its key, doc_b gets one, doc_c joins keyless.
    const { share, generatedKeys } = await world.updateShareLink.execute(
      owner,
      editOf(created.share, {
        documents: [
          { documentId: 'doc_a', versionId: null, requiresAccessKey: true },
          { documentId: 'doc_b', versionId: null, requiresAccessKey: true },
          { documentId: 'doc_c', versionId: null, requiresAccessKey: false },
        ],
      }),
    );
    expect(generatedKeys.map((key) => key.documentId)).toEqual(['doc_b']);
    const stored = world.shares.storedDocuments(share.id);
    expect(must(stored.find((row) => row.documentId === 'doc_a')).accessKeyHash).toBe(keptHash);
    expect(must(stored.find((row) => row.documentId === 'doc_b')).accessKeyHash).toBe(
      `hash:${must(generatedKeys[0]).accessKey}`,
    );
    expect(share.documents.map((doc) => doc.document.id)).toEqual(['doc_a', 'doc_b', 'doc_c']);
    expect(must(world.activity.entries.at(-1)).changes).toEqual({
      documents: 'changed',
      accessKey: 'changed',
    });
    expect(JSON.stringify(world.activity.entries)).not.toContain(must(generatedKeys[0]).accessKey);

    // doc_a's key goes off; dropping doc_c is a document change only.
    const off = await world.updateShareLink.execute(
      owner,
      editOf(share, {
        documents: [
          { documentId: 'doc_a', versionId: null, requiresAccessKey: false },
          { documentId: 'doc_b', versionId: null, requiresAccessKey: true },
        ],
      }),
    );
    expect(off.generatedKeys).toEqual([]);
    expect(
      must(world.shares.storedDocuments(share.id).find((row) => row.documentId === 'doc_a'))
        .accessKeyHash,
    ).toBeNull();
    expect(off.share.documents.map((doc) => doc.requiresAccessKey)).toEqual([false, true]);
  });

  it('counts a document dropped with its key as a key change', async () => {
    const { world, created } = await keyedLink();
    await world.updateShareLink.execute(
      owner,
      editOf(created.share, { documents: [{ documentId: 'doc_b', versionId: null, requiresAccessKey: false }] }),
    );
    expect(must(world.activity.entries.at(-1)).changes).toEqual({
      documents: 'changed',
      accessKey: 'changed',
    });
  });

  it('re-pins a document and replaces the list order', async () => {
    const { world, created } = await keyedLink();
    const { share } = await world.updateShareLink.execute(
      owner,
      editOf(created.share, {
        documents: [
          { documentId: 'doc_b', versionId: null, requiresAccessKey: false },
          { documentId: 'doc_a', versionId: 'doc_a_v2', requiresAccessKey: true },
        ],
      }),
    );
    expect(
      share.documents.map((doc) => [doc.document.id, doc.versionNumber, doc.isLatest]),
    ).toEqual([
      ['doc_b', 1, true],
      ['doc_a', 2, false],
    ]);
  });

  it('clears the expiry marker only when the expiry date changes (A6)', async () => {
    const world = seededWorld();
    world.seedLink(
      { id: 'old', expiresAt: '2026-10-01', expiredAt: new Date('2026-10-02T04:00:00.000Z') },
      [{ documentId: 'doc_a', versionId: null, order: 0, key: { kind: 'clear' } }],
    );
    const detail = await world.getShareLink.execute(owner, { id: 'old' });

    // Resubmitting the same, already passed, date is allowed and keeps the marker.
    await world.updateShareLink.execute(owner, editOf(detail, { title: 'Renombrado' }));
    expect(must(await world.shares.findById('old')).expiredAt).not.toBeNull();

    await world.updateShareLink.execute(owner, editOf(detail, { expiresAt: '2026-11-30' }));
    const renewed = must(await world.shares.findById('old'));
    expect(renewed.expiresAt).toBe('2026-11-30');
    expect(renewed.expiredAt).toBeNull();
  });

  it('refuses a new past expiry', async () => {
    const { world, created } = await keyedLink();
    await expect(
      world.updateShareLink.execute(owner, editOf(created.share, { expiresAt: '2026-10-01' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { expiresAt: expect.any(Array) } });
  });

  it.each([
    ['allowDownload', 'allowDownload'],
    ['expiresAt', 'expiresAt'],
    ['a document versionId', 'documents.0.versionId'],
    ['a document requiresAccessKey', 'documents.0.requiresAccessKey'],
  ] as const)(
    'refuses an edit that omits %s: VALIDATION, and the link keeps its keys, pin and expiry',
    async (_label, path) => {
      const { world, created } = await keyedLink();
      const pinned = await world.updateShareLink.execute(
        owner,
        editOf(created.share, {
          expiresAt: '2026-12-31',
          allowDownload: false,
          documents: [
            { documentId: 'doc_a', versionId: 'doc_a_v1', requiresAccessKey: true },
            { documentId: 'doc_b', versionId: null, requiresAccessKey: false },
          ],
        }),
      );
      const form = editOf(pinned.share) as Record<string, unknown> & {
        documents: Record<string, unknown>[];
      };
      if (path.startsWith('documents.')) delete form.documents[0]?.[path.split('.')[2] ?? ''];
      else delete form[path];

      const writes = world.shares.writeCount;
      const entries = world.activity.entries.length;
      await expect(world.updateShareLink.execute(owner, form as never)).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { [path]: ['validation.required'] },
      });
      expect(world.shares.writeCount).toBe(writes);
      expect(world.activity.entries).toHaveLength(entries);
      const after = await world.getShareLink.execute(owner, { id: created.share.id });
      expect(after).toMatchObject({ allowDownload: false, expiresAt: '2026-12-31' });
      expect(after.documents.map((d) => [d.versionId, d.requiresAccessKey])).toEqual([
        ['doc_a_v1', true],
        [null, false],
      ]);
    },
  );

  it('is INTEGRITY_LOCK on a revoked link and writes nothing', async () => {
    const { world, created } = await keyedLink();
    await world.revokeShareLink.execute(owner, { id: created.share.id });
    const writes = world.shares.writeCount;
    const entries = world.activity.entries.length;
    await expect(
      world.updateShareLink.execute(owner, editOf(created.share, { title: 'Otro' })),
    ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
    expect(world.shares.writeCount).toBe(writes);
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('is NOT_FOUND for an unknown link and VALIDATION for a bad reference, writing nothing', async () => {
    const { world, created } = await keyedLink();
    await expect(
      world.updateShareLink.execute(owner, editOf(created.share, { id: 'shr_missing' })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const writes = world.shares.writeCount;
    await expect(
      world.updateShareLink.execute(
        owner,
        editOf(created.share, { documents: [{ documentId: 'doc_missing', versionId: null, requiresAccessKey: false }] }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(world.shares.writeCount).toBe(writes);
  });

  it('hashes new keys before the unit of work opens and runs Serializable', async () => {
    const { world, created } = await keyedLink();
    world.secrets.hashedInsideUow.length = 0;
    await world.updateShareLink.execute(
      owner,
      editOf(created.share, {
        documents: [
          { documentId: 'doc_a', versionId: null, requiresAccessKey: true },
          { documentId: 'doc_b', versionId: null, requiresAccessKey: true },
        ],
      }),
    );
    expect(world.secrets.hashedInsideUow).toEqual([false]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(world.locks.acquired.map((row) => row.rowClass)).toEqual(['ShareLink']);
  });

  it('is CONFLICT when a concurrent edit left a document without the key nobody prepared', async () => {
    const { world, created } = await keyedLink();
    // The plan sees doc_a keyed (nothing to prepare); the key is removed before the locked recheck.
    const original = world.shares.documentsOf.bind(world.shares);
    let reads = 0;
    world.shares.documentsOf = async (id) => {
      reads += 1;
      const rows = await original(id);
      return reads === 1 ? rows : rows.map((row) => ({ ...row, hasAccessKey: false }));
    };
    await expect(world.updateShareLink.execute(owner, editOf(created.share))).rejects.toMatchObject(
      { code: 'CONFLICT' },
    );
    expect(must(world.shares.rows[0]).title).toBe('Propuesta Kairos');
  });

  it('lets an admin edit and refuses member and viewer without writing', async () => {
    const { world, created } = await keyedLink();
    await expect(
      world.updateShareLink.execute(admin, editOf(created.share, { title: 'Admin' })),
    ).resolves.toHaveProperty('share.title', 'Admin');
    const writes = world.shares.writeCount;
    for (const user of [member, viewer]) {
      await expect(
        world.updateShareLink.execute(user, editOf(created.share)),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(world.shares.writeCount).toBe(writes);
  });
});
