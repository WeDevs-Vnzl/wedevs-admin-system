import { describe, expect, it } from 'vitest';
import {
  admin,
  markdownDocument,
  member,
  owner,
  versionsWorld,
  viewer,
  nth,
} from '../../../../../../test/documents/versions/world';

// Behavioral spec: "lists versions newest first without content, flagging the current one" and "reads one
// version with its content; a version of another document is NOT_FOUND" of documents-lifecycle.test.ts.

describe('ListDocumentVersions and GetDocumentVersion', () => {
  it('lists versions newest first without content, flagging the current one', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 3);
    const rows = await world.listVersions.execute(viewer, { documentId: doc.id });
    expect(rows.map((v) => [v.versionNumber, v.isCurrent])).toEqual([
      [3, true],
      [2, false],
      [1, false],
    ]);
    expect(rows[0]).not.toHaveProperty('content');
    expect(rows[0]?.createdBy).toMatchObject({ id: owner.userId, name: 'owner' });
    expect(rows[0]?.changelog).toBe('cambio 3');
  });

  it('reads one version with its raw markdown, which is what the FE diff reads', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 2);
    const rows = await world.listVersions.execute(member, { documentId: doc.id });
    const first = nth(rows.filter((v) => v.versionNumber === 1));
    const second = nth(rows.filter((v) => v.versionNumber === 2));
    const [a, b] = await Promise.all(
      [first, second].map((v) =>
        world.getVersion.execute(viewer, { documentId: doc.id, versionId: v.id }),
      ),
    );
    expect(a).toMatchObject({ versionNumber: 1, content: '# v1', isCurrent: false });
    expect(b).toMatchObject({ versionNumber: 2, content: '# v2', isCurrent: true });
  });

  it('answers NOT_FOUND for a version of another document, an unknown document or an unknown version', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const other = await markdownDocument(world, 1, { title: 'Otra' });
    const foreign = nth(await world.listVersions.execute(owner, { documentId: other.id }));
    await expect(
      world.getVersion.execute(owner, { documentId: doc.id, versionId: foreign.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.getVersion.execute(owner, { documentId: doc.id, versionId: 'ver_missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.listVersions.execute(owner, { documentId: 'doc_missing' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.getVersion.execute(owner, { documentId: 'doc_missing', versionId: foreign.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('shows the versions of an archived document to the trash roles only', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    await world.archiveDocument.execute(owner, { id: doc.id });
    const version = nth(await world.listVersions.execute(admin, { documentId: doc.id }));
    expect(version?.versionNumber).toBe(1);
    expect(
      await world.getVersion.execute(admin, { documentId: doc.id, versionId: version.id }),
    ).toMatchObject({ content: '# v1' });
    for (const reader of [member, viewer]) {
      await expect(
        world.listVersions.execute(reader, { documentId: doc.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        world.getVersion.execute(reader, { documentId: doc.id, versionId: version.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});
