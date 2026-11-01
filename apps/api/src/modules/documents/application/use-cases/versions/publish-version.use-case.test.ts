import { describe, expect, it } from 'vitest';
import {
  NDA,
  markdownDocument,
  member,
  newDocument,
  owner,
  versionsWorld,
  viewer,
  rowOf,
} from '../../../../../../test/documents/versions/world';

// Behavioral spec: `publishVersion` of fe/src/mocks/services/documents.ts (documents-lifecycle.test.ts
// "publishVersion" and "refuse a document that is not markdown", S5), DT-138 and HU-18 CA1-CA2.

describe('PublishVersion', () => {
  it('freezes the stored draft as version N+1, makes it current and clears the draft', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 2);
    await world.saveDraft.execute(owner, { documentId: doc.id, content: '# Borrador' });
    world.clock.advance(60_000);
    const before = world.documents.committedVersions(doc.id).map((v) => ({ ...v }));

    const detail = await world.publishVersion.execute(member, {
      documentId: doc.id,
      changelog: ' Reintentos ',
    });

    expect(detail.currentVersion).toMatchObject({
      versionNumber: 3,
      format: 'MARKDOWN',
      content: '# Borrador',
      changelog: 'Reintentos',
      isCurrent: true,
    });
    expect(detail.versionCount).toBe(3);
    expect(detail.draftContent).toBeNull();
    expect(detail.draftUpdatedAt).toBeNull();
    expect(detail.updatedAt).toEqual(world.clock.now());
    // Earlier versions are never rewritten.
    expect(world.documents.committedVersions(doc.id).slice(0, 2)).toEqual(before);
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'VERSION_PUBLISH',
      entityId: doc.id,
      clientId: 'cli_kairos',
      metadata: { versionNumber: 3, format: 'MARKDOWN' },
    });
    expect(world.search.get('DOCUMENT', doc.id)?.body).toContain('# Borrador');
    expect(world.locks.acquired).toContainEqual({ rowClass: 'Document', id: doc.id });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('publishes the content the editor sends, without a changelog, and numbers from 1', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 0);
    const detail = await world.publishVersion.execute(owner, {
      documentId: doc.id,
      content: '# PRD v1',
    });
    expect(detail.currentVersion).toMatchObject({
      versionNumber: 1,
      content: '# PRD v1',
      changelog: null,
    });
    const again = await world.publishVersion.execute(owner, {
      documentId: doc.id,
      content: '# PRD v2',
      changelog: '   ',
    });
    expect(again.currentVersion).toMatchObject({ versionNumber: 2, changelog: null });
    expect(again.versionCount).toBe(2);
  });

  it('prefers the content sent over the stored draft and still clears the draft', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 0);
    await world.saveDraft.execute(owner, { documentId: doc.id, content: 'viejo' });
    const detail = await world.publishVersion.execute(owner, {
      documentId: doc.id,
      content: 'nuevo',
    });
    expect(detail.currentVersion?.content).toBe('nuevo');
    expect(detail.draftContent).toBeNull();
  });

  it('refuses no content and no draft (VALIDATION on content) and writes nothing', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const entries = world.activity.entries.length;
    for (const content of [undefined, null, '']) {
      await expect(
        world.publishVersion.execute(owner, { documentId: doc.id, content }),
      ).rejects.toMatchObject({
        code: 'VALIDATION',
        fieldErrors: { content: ['validation.required'] },
      });
    }
    expect(world.documents.committedVersions(doc.id)).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('refuses a locked document (INTEGRITY_LOCK) without the DTO', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const row = rowOf(world, doc.id);
    for (const locked of [
      { status: 'FIRMADO', signedAt: '2026-10-08' },
      { status: 'VENCIDO', signedAt: '2026-10-08' },
    ] as const) {
      world.documents.seed({ ...row, ...locked });
      await expect(
        world.publishVersion.execute(owner, { documentId: doc.id, content: '# x' }),
      ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
    }
    expect(world.documents.committedVersions(doc.id)).toHaveLength(1);
  });

  it('answers CONFLICT on a file or link document and changes nothing', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', owner);
    const doc = await world.createDocument.execute(
      owner,
      newDocument({ typeId: NDA, initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }),
    );
    const before = world.documents.committedVersions(doc.id).length;
    await expect(
      world.publishVersion.execute(owner, { documentId: doc.id, content: '# x' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(world.documents.committedVersions(doc.id)).toHaveLength(before);
  });

  it('refuses a changelog over 500 characters, an unknown and an archived document, and a Viewer', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 0);
    await expect(
      world.publishVersion.execute(owner, {
        documentId: doc.id,
        content: '# x',
        changelog: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { changelog: ['validation.tooLong'] },
    });
    await expect(
      world.publishVersion.execute(viewer, { documentId: doc.id, content: '# x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      world.publishVersion.execute(owner, { documentId: 'doc_missing', content: '# x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await world.archiveDocument.execute(owner, { id: doc.id });
    await expect(
      world.publishVersion.execute(owner, { documentId: doc.id, content: '# x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(world.documents.committedVersions(doc.id)).toHaveLength(0);
  });
});
