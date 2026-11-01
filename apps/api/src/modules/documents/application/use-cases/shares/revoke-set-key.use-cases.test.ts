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

async function keyedLink() {
  const world = seededWorld();
  const created = await world.createShareLink.execute(
    owner,
    form({
      documents: [{ documentId: 'doc_a', requiresAccessKey: true }, { documentId: 'doc_b' }],
    }),
  );
  return { world, link: created.share, firstKey: must(created.generatedKeys[0]).accessKey };
}

describe('revokeShareLink', () => {
  it('sets revokedAt, reports REVOKED and logs SHARE_REVOKE', async () => {
    const { world, link } = await keyedLink();
    world.clock.set('2026-10-31T09:00:00.000Z');
    const revoked = await world.revokeShareLink.execute(owner, { id: link.id });
    expect(revoked).toMatchObject({ status: 'REVOKED', revokedAt: world.clock.now() });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'SHARE_REVOKE',
      entityType: 'SHARE_LINK',
      entityId: link.id,
      entityLabel: link.title,
      actor: { actorType: 'USER', userId: owner.userId },
    });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    expect(world.locks.acquired).toEqual([{ rowClass: 'ShareLink', id: link.id }]);
  });

  it('is final: a second revoke is INTEGRITY_LOCK and changes nothing', async () => {
    const { world, link } = await keyedLink();
    await world.revokeShareLink.execute(owner, { id: link.id });
    const entries = world.activity.entries.length;
    await expect(world.revokeShareLink.execute(owner, { id: link.id })).rejects.toMatchObject({
      code: 'INTEGRITY_LOCK',
    });
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('is NOT_FOUND for an unknown link and FORBIDDEN below Admin', async () => {
    const { world, link } = await keyedLink();
    await expect(world.revokeShareLink.execute(owner, { id: 'shr_x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    for (const user of [member, viewer]) {
      await expect(world.revokeShareLink.execute(user, { id: link.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    await expect(world.revokeShareLink.execute(admin, { id: link.id })).resolves.toMatchObject({
      status: 'REVOKED',
    });
  });
});

describe('setShareDocumentAccessKey (DT-45)', () => {
  const input = (shareLinkId: string, documentId: string, action: string) =>
    ({ shareLinkId, documentId, action }) as Parameters<
      ReturnType<typeof seededWorld>['setAccessKey']['execute']
    >[1];

  it('regenerates a key: a new clear key once, a new hash, a new timestamp', async () => {
    const { world, link, firstKey } = await keyedLink();
    world.clock.advance(60_000);
    const result = await world.setAccessKey.execute(owner, input(link.id, 'doc_a', 'regenerate'));

    expect(result).toMatchObject({
      shareLinkId: link.id,
      documentId: 'doc_a',
      action: 'regenerate',
      requiresAccessKey: true,
      accessKeyUpdatedAt: world.clock.now(),
    });
    expect(result.accessKey).not.toBe(firstKey);
    expect(
      world.shares.storedDocuments(link.id).find((row) => row.documentId === 'doc_a'),
    ).toMatchObject({ accessKeyHash: `hash:${result.accessKey}` });
    expect(world.secrets.hashedInsideUow.every((inside) => !inside)).toBe(true);
  });

  it('generates a key for an open document and removes it again', async () => {
    const { world, link } = await keyedLink();
    const generated = await world.setAccessKey.execute(owner, input(link.id, 'doc_b', 'generate'));
    expect(generated).toMatchObject({ requiresAccessKey: true });
    expect(generated.accessKey).toEqual(expect.any(String));

    const removed = await world.setAccessKey.execute(owner, input(link.id, 'doc_b', 'remove'));
    expect(removed).toMatchObject({
      action: 'remove',
      requiresAccessKey: false,
      accessKeyUpdatedAt: null,
      accessKey: null,
    });
    const row = must(
      world.shares.storedDocuments(link.id).find((item) => item.documentId === 'doc_b'),
    );
    expect(row).toMatchObject({ hasAccessKey: false, accessKeyHash: null });
  });

  it('refuses a combination that does not match the key state with CONFLICT, hashing nothing', async () => {
    const { world, link } = await keyedLink();
    const hashed = world.secrets.hashedInsideUow.length;
    const writes = world.shares.writeCount;
    for (const [documentId, action] of [
      ['doc_a', 'generate'],
      ['doc_b', 'regenerate'],
      ['doc_b', 'remove'],
    ] as const) {
      await expect(
        world.setAccessKey.execute(owner, input(link.id, documentId, action)),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(world.secrets.hashedInsideUow).toHaveLength(hashed);
    expect(world.shares.writeCount).toBe(writes);
  });

  it('is NOT_FOUND for a document outside the link and for an unknown link', async () => {
    const { world, link } = await keyedLink();
    world.seedDocument('doc_c');
    await expect(
      world.setAccessKey.execute(owner, input(link.id, 'doc_c', 'generate')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.setAccessKey.execute(owner, input('shr_missing', 'doc_a', 'generate')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is VALIDATION for an unknown action, without the DTO', async () => {
    const { world, link } = await keyedLink();
    await expect(
      world.setAccessKey.execute(owner, input(link.id, 'doc_a', 'rotate')),
    ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { action: expect.any(Array) } });
  });

  it('is INTEGRITY_LOCK on a revoked link and leaves the key as it was', async () => {
    const { world, link } = await keyedLink();
    await world.revokeShareLink.execute(owner, { id: link.id });
    const before = world.shares.storedDocuments(link.id);
    await expect(
      world.setAccessKey.execute(owner, input(link.id, 'doc_a', 'regenerate')),
    ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
    expect(world.shares.storedDocuments(link.id)).toEqual(before);
  });

  it('is CONFLICT when the state changed between the plan and the locked recheck', async () => {
    const { world, link } = await keyedLink();
    // The plan sees doc_b open; by the locked recheck another caller has generated its key.
    const original = world.shares.documentsOf.bind(world.shares);
    let reads = 0;
    world.shares.documentsOf = async (id) => {
      reads += 1;
      const rows = await original(id);
      return reads === 1
        ? rows
        : rows.map((row) => (row.documentId === 'doc_b' ? { ...row, hasAccessKey: true } : row));
    };
    await expect(
      world.setAccessKey.execute(owner, input(link.id, 'doc_b', 'generate')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('logs UPDATE with only the changed marker, never the key', async () => {
    const { world, link } = await keyedLink();
    const result = await world.setAccessKey.execute(owner, input(link.id, 'doc_a', 'regenerate'));
    const entry = must(world.activity.entries.at(-1));
    expect(entry).toMatchObject({
      action: 'UPDATE',
      entityType: 'SHARE_LINK',
      entityId: link.id,
      changes: { accessKey: 'changed' },
      metadata: { documentId: 'doc_a', accessKeyAction: 'regenerate' },
    });
    expect(JSON.stringify(world.activity.entries)).not.toContain(must(result.accessKey));
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('is FORBIDDEN for member and viewer', async () => {
    const { world, link } = await keyedLink();
    for (const user of [member, viewer]) {
      await expect(
        world.setAccessKey.execute(user, input(link.id, 'doc_a', 'regenerate')),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      world.setAccessKey.execute(admin, input(link.id, 'doc_a', 'regenerate')),
    ).resolves.toMatchObject({ action: 'regenerate' });
  });
});
