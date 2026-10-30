import { describe, expect, it } from 'vitest';
import {
  KAIROS_WEB,
  SOLARIS,
  admin,
  doc,
  member,
  newNote,
  seededWorld,
} from '../../../../test/commercial/notes/world';

describe('NoteTaggableResolver', () => {
  it('is the NOTE target on the note resource, with its label and first client', async () => {
    const w = seededWorld();
    const note = await w.createNote.execute(
      member,
      newNote({ title: null, content: doc('uno dos tres'), links: [KAIROS_WEB, SOLARIS] }),
    );
    expect(w.taggableResolver.entityType).toBe('NOTE');
    expect(w.taggableResolver.resource).toBe('note');
    await expect(w.taggableResolver.resolve(note.id)).resolves.toEqual({
      label: 'uno dos tres',
      clientId: 'cli_solaris',
    });
  });

  it('does not resolve an unknown or archived note', async () => {
    const w = seededWorld();
    const note = await w.createNote.execute(member, newNote());
    await w.archiveNote.execute(admin, { id: note.id });
    await expect(w.taggableResolver.resolve(note.id)).resolves.toBeNull();
    await expect(w.taggableResolver.resolve('not_nope')).resolves.toBeNull();
  });
});
