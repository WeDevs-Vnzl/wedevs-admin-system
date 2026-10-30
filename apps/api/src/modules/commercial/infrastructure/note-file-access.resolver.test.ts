import { describe, expect, it } from 'vitest';
import {
  KAIROS,
  admin,
  member,
  newNote,
  seededWorld,
} from '../../../../test/commercial/notes/world';
import { NoteFileAccessResolver } from './note-file-access.resolver';

describe('NoteFileAccessResolver', () => {
  it('claims a file of a live note with `read` on notes, and nothing else', async () => {
    const w = seededWorld();
    w.seedFile('fil_a', member);
    w.seedFile('fil_loose', member);
    const note = await w.createNote.execute(
      member,
      newNote({ links: [KAIROS], attachmentFileIds: ['fil_a'] }),
    );
    const resolver = new NoteFileAccessResolver(w.notes);
    await expect(resolver.resolve('fil_a')).resolves.toEqual({
      kind: 'resource',
      resource: 'note',
    });
    await expect(resolver.resolve('fil_loose')).resolves.toBeNull();
    await w.archiveNote.execute(admin, { id: note.id });
    await expect(resolver.resolve('fil_a')).resolves.toBeNull();
  });
});
