import { describe, expect, it } from 'vitest';
import {
  NDA,
  member,
  newDocument,
  owner,
  versionsWorld,
  viewer,
  rowOf,
} from '../../../../../../test/documents/versions/world';

// Behavioral spec: `uploadVersion` of fe/src/mocks/services/documents.ts ("uploadVersion (S5: update link)"),
// DT-136 (a held file is refused), DT-138 (version lock) and C23 (file reservation under the File row lock).

const newNda = async (world: ReturnType<typeof versionsWorld>, over = {}) =>
  world.createDocument.execute(owner, newDocument({ typeId: NDA, ...over }));

describe('UploadVersion', () => {
  it('adds an ENLACE version with the new URL', async () => {
    const world = versionsWorld();
    const doc = await newNda(world);
    const detail = await world.uploadVersion.execute(member, {
      documentId: doc.id,
      format: 'ENLACE',
      url: ' https://vault.example.com/shared/kairos-staging-2 ',
      changelog: 'Nuevo ítem',
    });
    expect(detail.currentVersion).toMatchObject({
      versionNumber: 1,
      format: 'ENLACE',
      url: 'https://vault.example.com/shared/kairos-staging-2',
      file: null,
      changelog: 'Nuevo ítem',
    });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'VERSION_PUBLISH',
      metadata: { versionNumber: 1, format: 'ENLACE' },
    });
    expect(world.locks.acquired).toContainEqual({ rowClass: 'Document', id: doc.id });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('refuses a URL that is not http(s) (VALIDATION on url) and writes nothing', async () => {
    const world = versionsWorld();
    const doc = await newNda(world);
    for (const url of ['javascript:alert(1)', 'ftp://x.test/a', 'data:text/html,x', '   ']) {
      await expect(
        world.uploadVersion.execute(owner, { documentId: doc.id, format: 'ENLACE', url }),
      ).rejects.toMatchObject({ code: 'VALIDATION', fieldErrors: { url: expect.any(Array) } });
    }
    expect(world.documents.committedVersions(doc.id)).toHaveLength(0);
  });

  it('attaches a READY file under the File row lock, logging UPLOAD', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', member);
    const doc = await newNda(world);
    const detail = await world.uploadVersion.execute(member, {
      documentId: doc.id,
      format: 'ARCHIVO',
      fileId: 'fil_a',
      changelog: ' v2 firmada ',
    });
    expect(detail.currentVersion).toMatchObject({
      versionNumber: 1,
      format: 'ARCHIVO',
      changelog: 'v2 firmada',
      file: { id: 'fil_a', originalName: 'fil_a.pdf' },
    });
    expect(world.fileRepo.locked).toEqual(['fil_a']);
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'UPLOAD',
      metadata: { versionNumber: 1, format: 'ARCHIVO' },
    });
  });

  it('refuses a file some version already holds (CONFLICT), here or in another document', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', owner);
    const first = await newNda(world, { initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } });
    const second = await newNda(world, { title: 'Otro' });
    for (const documentId of [first.id, second.id]) {
      await expect(
        world.uploadVersion.execute(owner, { documentId, format: 'ARCHIVO', fileId: 'fil_a' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(world.documents.committedVersions(first.id)).toHaveLength(1);
    expect(world.documents.committedVersions(second.id)).toHaveLength(0);
  });

  it('answers a plain NOT_FOUND for an unknown, a PENDING, a foreign unattached or a deleted file (C14)', async () => {
    const world = versionsWorld();
    world.seedFile('fil_pending', owner, 'PENDING');
    world.seedFile('fil_foreign', member);
    const doc = await newNda(world);
    for (const fileId of ['fil_missing', 'fil_pending', 'fil_foreign']) {
      await expect(
        world.uploadVersion.execute(owner, { documentId: doc.id, format: 'ARCHIVO', fileId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(world.documents.committedVersions(doc.id)).toHaveLength(0);
  });

  it('refuses a locked document before touching the file (INTEGRITY_LOCK)', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', owner);
    const doc = await newNda(world);
    const row = rowOf(world, doc.id);
    world.documents.seed({ ...row, status: 'FIRMADO', signedAt: '2026-10-08' });
    await expect(
      world.uploadVersion.execute(owner, {
        documentId: doc.id,
        format: 'ARCHIVO',
        fileId: 'fil_a',
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
    expect(world.fileRepo.locked).toEqual([]);
    world.documents.seed({ ...row, status: 'VENCIDO', signedAt: '2026-10-08' });
    await expect(
      world.uploadVersion.execute(owner, {
        documentId: doc.id,
        format: 'ENLACE',
        url: 'https://x.test/a',
      }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
  });

  it('refuses a Viewer, an unknown and an archived document, and an over-long changelog', async () => {
    const world = versionsWorld();
    const doc = await newNda(world);
    const link = { format: 'ENLACE', url: 'https://x.test/a' } as const;
    await expect(
      world.uploadVersion.execute(viewer, { documentId: doc.id, ...link }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      world.uploadVersion.execute(owner, { documentId: 'doc_missing', ...link }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      world.uploadVersion.execute(owner, {
        documentId: doc.id,
        ...link,
        changelog: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { changelog: ['validation.tooLong'] },
    });
    await world.archiveDocument.execute(owner, { id: doc.id });
    await expect(
      world.uploadVersion.execute(owner, { documentId: doc.id, ...link }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
