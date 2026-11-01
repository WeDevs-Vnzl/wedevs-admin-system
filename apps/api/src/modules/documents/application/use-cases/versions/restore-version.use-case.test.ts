import { describe, expect, it } from 'vitest';
import {
  NDA,
  markdownDocument,
  member,
  newDocument,
  nth,
  owner,
  versionsWorld,
  viewer,
  rowOf,
} from '../../../../../../test/documents/versions/world';

// Behavioral spec: `restoreVersion` of fe/src/mocks/services/documents.ts (documents-lifecycle.test.ts
// "restoreVersion (S5: restoring copies the chosen version)"), DT-136 (a restored file reuses its fileId) and
// DT-138.

describe('RestoreVersion', () => {
  it('creates a new current version copying the chosen one; history is untouched', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 3);
    const first = nth(world.documents.committedVersions(doc.id).map((v) => ({ ...v })));

    const detail = await world.restoreVersion.execute(member, {
      documentId: doc.id,
      versionId: first.id,
    });

    expect(detail.currentVersion).toMatchObject({
      versionNumber: 4,
      format: 'MARKDOWN',
      content: '# v1',
      changelog: null,
      isCurrent: true,
    });
    const stored = world.documents.committedVersions(doc.id);
    expect(stored).toHaveLength(4);
    expect(stored.find((v) => v.id === first.id)).toEqual(first);
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'VERSION_PUBLISH',
      metadata: { versionNumber: 4, restoredFrom: 1 },
    });
    expect(world.search.get('DOCUMENT', doc.id)?.body).toContain('# v1');
    expect(world.locks.acquired).toContainEqual({ rowClass: 'Document', id: doc.id });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('copies an ENLACE version and keeps the optional changelog', async () => {
    const world = versionsWorld();
    const doc = await world.createDocument.execute(owner, newDocument({ typeId: NDA }));
    await world.uploadVersion.execute(owner, {
      documentId: doc.id,
      format: 'ENLACE',
      url: 'https://x.test/a',
    });
    await world.uploadVersion.execute(owner, {
      documentId: doc.id,
      format: 'ENLACE',
      url: 'https://x.test/b',
    });
    const first = nth(world.documents.committedVersions(doc.id));
    const detail = await world.restoreVersion.execute(owner, {
      documentId: doc.id,
      versionId: first.id,
      changelog: 'Vuelve al enlace anterior',
    });
    expect(detail.currentVersion).toMatchObject({
      versionNumber: 3,
      format: 'ENLACE',
      url: 'https://x.test/a',
      changelog: 'Vuelve al enlace anterior',
    });
  });

  it('copies the file of an ARCHIVO version with the same fileId and no new reserve check (DT-136)', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', owner);
    const doc = await world.createDocument.execute(
      owner,
      newDocument({ typeId: NDA, initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }),
    );
    world.seedFile('fil_b', owner);
    await world.uploadVersion.execute(owner, {
      documentId: doc.id,
      format: 'ARCHIVO',
      fileId: 'fil_b',
    });
    const first = nth(world.documents.committedVersions(doc.id));
    world.fileRepo.locked.length = 0;

    // A Member who did not upload the file restores it: no reservation, so no claim check or File lock.
    const detail = await world.restoreVersion.execute(member, {
      documentId: doc.id,
      versionId: first.id,
      changelog: 'Reenvío',
    });

    expect(detail.currentVersion).toMatchObject({
      versionNumber: 3,
      changelog: 'Reenvío',
      file: { id: 'fil_a' },
    });
    expect(world.fileRepo.locked).toEqual([]);
    const holders = world.documents.committedVersions(doc.id).filter((v) => v.fileId === 'fil_a');
    expect(holders.map((v) => v.versionNumber)).toEqual([1, 3]);
  });

  it('refuses a version of another document (NOT_FOUND) and an unknown one', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const other = await markdownDocument(world, 1, { title: 'Otra nota' });
    const foreign = nth(world.documents.committedVersions(other.id));
    for (const versionId of [foreign.id, 'ver_missing']) {
      await expect(
        world.restoreVersion.execute(owner, { documentId: doc.id, versionId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(world.documents.committedVersions(doc.id)).toHaveLength(1);
  });

  it('refuses a locked document (INTEGRITY_LOCK), FIRMADO or signed VENCIDO', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 2);
    const first = nth(world.documents.committedVersions(doc.id));
    const row = rowOf(world, doc.id);
    for (const locked of [
      { status: 'FIRMADO', signedAt: '2026-10-08' },
      { status: 'VENCIDO', signedAt: '2026-10-08' },
    ] as const) {
      world.documents.seed({ ...row, ...locked });
      await expect(
        world.restoreVersion.execute(owner, { documentId: doc.id, versionId: first.id }),
      ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
    }
    expect(world.documents.committedVersions(doc.id)).toHaveLength(2);
  });

  it('refuses a Viewer, an archived document and an over-long changelog', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const first = nth(world.documents.committedVersions(doc.id));
    const input = { documentId: doc.id, versionId: first.id };
    await expect(world.restoreVersion.execute(viewer, input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      world.restoreVersion.execute(owner, { ...input, changelog: 'x'.repeat(501) }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await world.archiveDocument.execute(owner, { id: doc.id });
    await expect(world.restoreVersion.execute(owner, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
