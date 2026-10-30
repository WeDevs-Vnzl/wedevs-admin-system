import { describe, expect, it } from 'vitest';
import { admin, member, newNote, seededWorld } from '../../../../test/commercial/notes/world';

describe('NoteRestoreHandler', () => {
  it('registers as the NOTE handler on the note resource and restores through the use case', async () => {
    const w = seededWorld();
    const note = await w.createNote.execute(member, newNote({ title: 'Restaurable' }));
    await w.archiveNote.execute(admin, { id: note.id });
    expect(w.restoreHandler.entityType).toBe('NOTE');
    expect(w.restoreHandler.resource).toBe('note');
    await expect(w.restoreHandler.restore(admin, note.id)).resolves.toEqual({
      type: 'NOTE',
      id: note.id,
      label: 'Restaurable',
    });
    await expect(w.restoreHandler.restore(admin, note.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
