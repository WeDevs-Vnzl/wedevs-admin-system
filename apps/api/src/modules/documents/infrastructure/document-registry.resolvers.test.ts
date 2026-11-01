import { describe, expect, it } from 'vitest';
import {
  KAIROS_WEB,
  admin,
  newDocument,
  owner,
  seededWorld,
} from '../../../../test/documents/records/world';

describe('DocumentTaggableResolver', () => {
  it('resolves a live document with its label and client scope, governed by update on document', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument({ links: [KAIROS_WEB] }));
    expect(world.taggableResolver).toMatchObject({ entityType: 'DOCUMENT', resource: 'document' });
    expect(await world.taggableResolver.resolve(doc.id)).toEqual({
      label: 'NDA con Kairos',
      clientId: 'cli_kairos',
    });
  });

  it('answers null for an unknown or archived document', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    expect(await world.taggableResolver.resolve('doc_missing')).toBeNull();
    await world.archiveDocument.execute(admin, { id: doc.id });
    expect(await world.taggableResolver.resolve(doc.id)).toBeNull();
  });
});

describe('DocumentNoteTargetResolver', () => {
  it('lets a note hang from a document and flags an archived one', async () => {
    const world = seededWorld();
    const live = await world.createDocument.execute(owner, newDocument());
    const gone = await world.createDocument.execute(owner, newDocument({ title: 'Viejo' }));
    await world.archiveDocument.execute(admin, { id: gone.id });

    const found = await world.noteTargetResolver.resolve([live.id, gone.id, 'doc_missing']);

    expect([...found.keys()]).toEqual([live.id, gone.id]);
    expect(found.get(live.id)).toEqual({
      ref: { type: 'DOCUMENT', id: live.id, code: 'DOC-0001', label: 'NDA con Kairos' },
      archived: false,
    });
    expect(found.get(gone.id)?.archived).toBe(true);
  });

  it('registers in the note registry like the other targets', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    world.targets.register(world.noteTargetResolver);
    const refs = await world.targets.requireLive(
      [{ entityType: 'DOCUMENT', entityId: doc.id }],
      () => 'links',
    );
    expect(refs).toEqual([
      { type: 'DOCUMENT', id: doc.id, code: 'DOC-0001', label: 'NDA con Kairos' },
    ]);
    await world.archiveDocument.execute(admin, { id: doc.id });
    await expect(
      world.targets.requireLive([{ entityType: 'DOCUMENT', entityId: doc.id }], () => 'links'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
