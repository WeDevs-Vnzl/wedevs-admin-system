import { describe, expect, it } from 'vitest';
import {
  admin,
  member,
  newNote,
  otherMember,
  owner,
  seededWorld,
  viewer,
} from '../../../../../test/commercial/notes/world';

async function withNotes() {
  const w = seededWorld();
  const mine = await w.createNote.execute(member, newNote({ title: 'Mía' }));
  const theirs = await w.createNote.execute(otherMember, newNote({ title: 'Ajena' }));
  return { w, mine, theirs, base: w.activity.entries.length };
}

describe('ArchiveNote', () => {
  it('archives, records DELETE with the client scope and archives the search entry', async () => {
    const { w, mine, base } = await withNotes();
    w.clock.advance(1000);
    const result = await w.archiveNote.execute(admin, { id: mine.id });
    expect(result).toEqual({ id: mine.id, archivedAt: w.clock.now() });
    expect(w.activity.entries.slice(base)).toMatchObject([
      { action: 'DELETE', entityType: 'NOTE', entityId: mine.id, clientId: 'cli_kairos' },
    ]);
    expect(w.search.get('NOTE', mine.id)?.archived).toBe(true);
    await expect(w.getNote.execute(admin, { id: mine.id })).resolves.toMatchObject({
      archivedAt: w.clock.now(),
    });
  });

  it('lets a Member archive only their own note (C13)', async () => {
    const { w, mine, theirs, base } = await withNotes();
    await expect(w.archiveNote.execute(member, { id: theirs.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(w.activity.entries).toHaveLength(base);
    await expect(w.archiveNote.execute(member, { id: mine.id })).resolves.toMatchObject({
      id: mine.id,
    });
  });

  it('refuses a Viewer, and answers NOT_FOUND for an unknown or already archived note', async () => {
    const { w, mine } = await withNotes();
    await expect(w.archiveNote.execute(viewer, { id: mine.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(w.archiveNote.execute(owner, { id: 'not_nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await w.archiveNote.execute(owner, { id: mine.id });
    await expect(w.archiveNote.execute(owner, { id: mine.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('keeps the attachments of an archived note out of the live file claims', async () => {
    const w = seededWorld();
    w.seedFile('fil_a', member);
    const note = await w.createNote.execute(member, newNote({ attachmentFileIds: ['fil_a'] }));
    await expect(w.fileRegistry.claimsFor('fil_a')).resolves.toEqual([
      { kind: 'resource', resource: 'note' },
    ]);
    await w.archiveNote.execute(member, { id: note.id });
    await expect(w.fileRegistry.claimsFor('fil_a')).resolves.toEqual([]);
  });
});

describe('RestoreNote', () => {
  it('restores an archived note: RESTORE entry, reindexed, listed again', async () => {
    const { w, mine } = await withNotes();
    await w.archiveNote.execute(admin, { id: mine.id });
    const before = w.activity.entries.length;
    const ref = await w.restoreNote.execute(admin, { id: mine.id });
    expect(ref).toEqual({ type: 'NOTE', id: mine.id, label: 'Mía' });
    expect(w.activity.entries.slice(before)).toMatchObject([
      { action: 'RESTORE', entityId: mine.id, clientId: 'cli_kairos' },
    ]);
    expect(w.search.get('NOTE', mine.id)).toMatchObject({ archived: false, title: 'Mía' });
    await expect(w.getNote.execute(member, { id: mine.id })).resolves.toMatchObject({
      archivedAt: null,
    });
  });

  it('is for the trash roles only and answers NOT_FOUND for a live or unknown note', async () => {
    const { w, mine } = await withNotes();
    await expect(w.restoreNote.execute(member, { id: mine.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(w.restoreNote.execute(admin, { id: mine.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(w.restoreNote.execute(admin, { id: 'not_nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('the trash handler delegates to the same use case', async () => {
    const { w, mine } = await withNotes();
    await w.archiveNote.execute(admin, { id: mine.id });
    expect(w.restoreHandler).toMatchObject({ entityType: 'NOTE', resource: 'note' });
    await expect(w.restoreHandler.restore(admin, mine.id)).resolves.toMatchObject({ id: mine.id });
  });
});
