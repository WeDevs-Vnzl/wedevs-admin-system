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
import { DOCUMENT_CONTENT_MAX } from '../../../domain';

// Behavioral spec: `saveDraft` of fe/src/mocks/services/documents.ts (documents-lifecycle.test.ts "saveDraft",
// S5), DT-139 (explicit save, one UPDATE per save) and DT-138 (the version lock).

describe('SaveDraft', () => {
  it('stores the draft and its time, creates no version and logs one UPDATE without the content', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    world.clock.advance(60_000);
    const entries = world.activity.entries.length;

    const saved = await world.saveDraft.execute(member, {
      documentId: doc.id,
      content: '# TSD\n\nNuevo texto',
    });

    expect(saved).toEqual({ documentId: doc.id, draftUpdatedAt: world.clock.now() });
    const row = world.documents.rows.find((r) => r.id === doc.id);
    expect(row).toMatchObject({
      draftContent: '# TSD\n\nNuevo texto',
      draftUpdatedAt: world.clock.now(),
      updatedAt: world.clock.now(),
    });
    expect(world.documents.committedVersions(doc.id)).toHaveLength(1);
    expect(world.activity.entries).toHaveLength(entries + 1);
    const entry = world.activity.entries.at(-1);
    expect(entry).toMatchObject({
      actor: { actorType: 'USER', userId: member.userId },
      action: 'UPDATE',
      entityType: 'DOCUMENT',
      entityId: doc.id,
      entityLabel: doc.title,
      clientId: 'cli_kairos',
      metadata: { draft: true },
    });
    expect(entry?.changes).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('Nuevo texto');
    expect(world.locks.acquired).toContainEqual({ rowClass: 'Document', id: doc.id });
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('saves on a markdown document that has no published version yet (the type default decides)', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 0);
    await world.saveDraft.execute(owner, { documentId: doc.id, content: 'borrador' });
    expect(world.documents.rows.find((r) => r.id === doc.id)?.draftContent).toBe('borrador');
  });

  it('refuses a FIRMADO document and a signed VENCIDO one (INTEGRITY_LOCK), writing nothing', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const row = rowOf(world, doc.id);
    const entries = world.activity.entries.length;
    for (const locked of [
      { status: 'FIRMADO', signedAt: '2026-10-08' },
      { status: 'VENCIDO', signedAt: '2026-10-08' },
    ] as const) {
      world.documents.seed({ ...row, ...locked });
      await expect(
        world.saveDraft.execute(owner, { documentId: doc.id, content: 'x' }),
      ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK' });
    }
    expect(world.documents.rows.find((r) => r.id === doc.id)?.draftContent).toBeNull();
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('lets an unsigned VENCIDO document keep a draft (the lock needs signedAt, DT-138)', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    const row = rowOf(world, doc.id);
    world.documents.seed({ ...row, status: 'VENCIDO', signedAt: null });
    await world.saveDraft.execute(owner, { documentId: doc.id, content: 'x' });
    expect(world.documents.rows.find((r) => r.id === doc.id)?.draftContent).toBe('x');
  });

  it('answers CONFLICT on a file or link document and changes nothing', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', owner);
    const doc = await world.createDocument.execute(
      owner,
      newDocument({ typeId: NDA, initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }),
    );
    const noVersion = await world.createDocument.execute(owner, newDocument({ typeId: NDA }));
    const entries = world.activity.entries.length;
    for (const id of [doc.id, noVersion.id]) {
      await expect(
        world.saveDraft.execute(owner, { documentId: id, content: '# x' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    }
    expect(world.documents.rows.every((r) => r.draftContent === null)).toBe(true);
    expect(world.activity.entries).toHaveLength(entries);
  });

  it('answers NOT_FOUND for an unknown or an archived document', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 1);
    await expect(
      world.saveDraft.execute(owner, { documentId: 'doc_missing', content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await world.archiveDocument.execute(owner, { id: doc.id });
    await expect(
      world.saveDraft.execute(owner, { documentId: doc.id, content: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a Viewer before reading anything', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 0);
    await expect(
      world.saveDraft.execute(viewer, { documentId: doc.id, content: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(world.locks.acquired).toHaveLength(0);
  });

  it('enforces the size cap without the DTO', async () => {
    const world = versionsWorld();
    const doc = await markdownDocument(world, 0);
    await expect(
      world.saveDraft.execute(owner, {
        documentId: doc.id,
        content: 'x'.repeat(DOCUMENT_CONTENT_MAX + 1),
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { content: ['validation.tooLong'] },
    });
  });
});
