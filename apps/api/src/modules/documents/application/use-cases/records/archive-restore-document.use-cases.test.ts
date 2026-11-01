import { describe, expect, it } from 'vitest';
import {
  admin,
  member,
  newDocument,
  owner,
  query,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/records/world';
import { ForbiddenError, NotFoundError } from '../../../../../shared/domain/domain-error';

// Behavioral spec: `archiveDocument` / `archiveDocuments` of fe/src/mocks/services/documents.ts and
// `trash.ts:78-96`, plus PRD §7.7 (restore) and PRD §4.3 (who deletes and restores).

describe('ArchiveDocument and ArchiveDocuments', () => {
  it('archives a document, logs DELETE, flips the search entry and drops it from the list', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    world.clock.advance(60_000);

    const result = await world.archiveDocument.execute(admin, { id: doc.id });

    expect(result).toEqual({ id: doc.id, archivedAt: world.clock.now() });
    expect(world.documents.rows[0]).toMatchObject({ deletedAt: world.clock.now() });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'DELETE',
      entityId: doc.id,
      clientId: 'cli_kairos',
    });
    expect(world.search.get('DOCUMENT', doc.id)?.archived).toBe(true);
    expect((await world.listDocuments.execute(owner, query())).items).toEqual([]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
    await expect(world.archiveDocument.execute(admin, { id: doc.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('is Owner and Admin only: a Member and a Viewer are FORBIDDEN', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    for (const actor of [member, viewer]) {
      await expect(world.archiveDocument.execute(actor, { id: doc.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(world.archiveDocuments.execute(actor, { ids: [doc.id] })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(world.documents.rows[0]?.deletedAt).toBeNull();
  });

  it('archives a selection all or nothing, locking every document in one call', async () => {
    const world = seededWorld();
    const a = await world.createDocument.execute(owner, newDocument({ title: 'A' }));
    const b = await world.createDocument.execute(owner, newDocument({ title: 'B' }));

    await expect(
      world.archiveDocuments.execute(admin, { ids: [a.id, 'doc_missing'] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(world.documents.rows.every((row) => row.deletedAt === null)).toBe(true);
    expect(world.search.get('DOCUMENT', a.id)?.archived).toBe(false);

    const result = await world.archiveDocuments.execute(admin, { ids: [b.id, a.id, b.id] });
    expect(result.archived.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(world.locks.acquired.map((l) => l.id)).toEqual([b.id, a.id].sort());
    expect(world.activity.entries.filter((e) => e.action === 'DELETE')).toHaveLength(2);
  });

  it('refuses a selection holding an already archived document', async () => {
    const world = seededWorld();
    const a = await world.createDocument.execute(owner, newDocument({ title: 'A' }));
    const b = await world.createDocument.execute(owner, newDocument({ title: 'B' }));
    await world.archiveDocument.execute(admin, { id: a.id });
    await expect(
      world.archiveDocuments.execute(admin, { ids: [a.id, b.id] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(world.documents.rows.find((row) => row.id === b.id)?.deletedAt).toBeNull();
  });
});

describe('RestoreDocument', () => {
  it('restores an archived document, logs RESTORE and reindexes it live', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await world.archiveDocument.execute(admin, { id: doc.id });
    world.clock.advance(60_000);

    const ref = await world.restoreDocument.execute(admin, { id: doc.id });

    expect(ref).toEqual({
      type: 'DOCUMENT',
      id: doc.id,
      code: 'DOC-0001',
      label: 'NDA con Kairos',
    });
    expect(world.documents.rows[0]).toMatchObject({
      deletedAt: null,
      updatedAt: world.clock.now(),
    });
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'RESTORE',
      clientId: 'cli_kairos',
    });
    expect(world.search.get('DOCUMENT', doc.id)?.archived).toBe(false);
    expect((await world.listDocuments.execute(owner, query())).items).toHaveLength(1);
  });

  it('answers NOT_FOUND for a live or unknown document and FORBIDDEN without the trash grant', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await expect(world.restoreDocument.execute(admin, { id: doc.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      world.restoreDocument.execute(admin, { id: 'doc_missing' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await world.archiveDocument.execute(admin, { id: doc.id });
    for (const actor of [member, viewer]) {
      await expect(world.restoreDocument.execute(actor, { id: doc.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  it('the trash handler delegates to the same use case', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await world.archiveDocument.execute(owner, { id: doc.id });
    expect(world.restoreHandler).toMatchObject({ entityType: 'DOCUMENT', resource: 'document' });
    const ref = await world.restoreHandler.restore(owner, doc.id);
    expect(ref.id).toBe(doc.id);
    expect(world.activity.entries.at(-1)?.action).toBe('RESTORE');
  });
});
