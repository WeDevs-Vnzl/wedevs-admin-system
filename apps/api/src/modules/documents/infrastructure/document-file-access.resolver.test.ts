import { describe, expect, it } from 'vitest';
import { NDA, newDocument, owner, versionsWorld } from '../../../../test/documents/versions/world';

// The file claim of a document (C23, A3): a live document's version claims `read` on `document`.

describe('DocumentFileAccessResolver', () => {
  it('claims a file of a live document with `read` on documents, and nothing else', async () => {
    const world = versionsWorld();
    world.seedFile('fil_a', owner);
    world.seedFile('fil_loose', owner);
    const doc = await world.createDocument.execute(
      owner,
      newDocument({ typeId: NDA, initialVersion: { format: 'ARCHIVO', fileId: 'fil_a' } }),
    );
    await expect(world.fileResolver.resolve('fil_a')).resolves.toEqual({
      kind: 'resource',
      resource: 'document',
    });
    await expect(world.fileResolver.resolve('fil_loose')).resolves.toBeNull();

    await world.archiveDocument.execute(owner, { id: doc.id });
    await expect(world.fileResolver.resolve('fil_a')).resolves.toBeNull();
    await world.restoreDocument.execute(owner, { id: doc.id });
    await expect(world.fileResolver.resolve('fil_a')).resolves.not.toBeNull();
  });
});
