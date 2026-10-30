import { describe, expect, it } from 'vitest';
import type { NoteLinkTarget } from '../../domain/note-link';
import type { NoteLinkTargetResolver } from '../note-link-target.registry';
import {
  ANA,
  KAIROS,
  KAIROS_WEB,
  SOLARIS,
  member,
  newNote,
  otherMember,
  seededWorld,
  viewer,
} from '../../../../../test/commercial/notes/world';

async function withNote(links: readonly NoteLinkTarget[] = [KAIROS, KAIROS_WEB]) {
  const w = seededWorld();
  const note = await w.createNote.execute(member, newNote({ links: [...links] }));
  return { w, note, base: w.activity.entries.length };
}

describe('PinNote', () => {
  it('pins and unpins, recording the change only when it changes', async () => {
    const { w, note, base } = await withNote();
    expect((await w.pinNote.execute(member, { id: note.id, pinned: true })).pinned).toBe(true);
    await w.pinNote.execute(member, { id: note.id, pinned: true });
    expect((await w.pinNote.execute(member, { id: note.id, pinned: false })).pinned).toBe(false);
    const entries = w.activity.entries.slice(base);
    expect(entries.map((e) => e.action)).toEqual(['UPDATE', 'UPDATE']);
    expect(entries[0]?.changes).toEqual({ pinned: [false, true] });
  });

  it('refuses a Viewer and answers NOT_FOUND for an archived note', async () => {
    const { w, note } = await withNote();
    await expect(w.pinNote.execute(viewer, { id: note.id, pinned: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await w.archiveNote.execute(member, { id: note.id });
    await expect(w.pinNote.execute(member, { id: note.id, pinned: true })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('LinkNote', () => {
  it('links a new target, locking the note, and records LINK with the new client scope', async () => {
    const { w, note, base } = await withNote([KAIROS]);
    const linked = await w.linkNote.execute(member, { noteId: note.id, target: SOLARIS });
    expect(linked.links.map((l) => l.id)).toEqual(['cli_kairos', 'cli_solaris']);
    const entry = w.activity.entries.slice(base);
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatchObject({
      action: 'LINK',
      entityType: 'NOTE',
      clientId: 'cli_kairos',
      touchClientIds: ['cli_kairos', 'cli_solaris'],
      metadata: { entityType: 'CLIENT', entityId: 'cli_solaris' },
    });
    expect(w.notes.locked).toContain(note.id);
  });

  it('refuses a repeat with CONFLICT pointing at the target, an unknown one with NOT_FOUND', async () => {
    const { w, note } = await withNote([KAIROS]);
    await expect(
      w.linkNote.execute(member, { noteId: note.id, target: KAIROS }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'notes.errors.alreadyLinked',
      entity: { id: 'cli_kairos' },
    });
    await expect(
      w.linkNote.execute(member, {
        noteId: note.id,
        target: { entityType: 'CLIENT', entityId: 'cli_missing' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('links targets other contexts registered and refuses an archived one', async () => {
    const { w, note } = await withNote([KAIROS]);
    const archived = new Set(['inv_old']);
    const invoices: NoteLinkTargetResolver = {
      entityType: 'INVOICE',
      async resolve(ids) {
        return new Map(
          ids.map((id) => [
            id,
            { ref: { type: 'INVOICE' as const, id, label: id }, archived: archived.has(id) },
          ]),
        );
      },
    };
    w.targetRegistry.register(invoices);
    const linked = await w.linkNote.execute(member, {
      noteId: note.id,
      target: { entityType: 'INVOICE', entityId: 'inv_1' },
    });
    expect(linked.links.map((l) => l.type)).toEqual(['CLIENT', 'INVOICE']);
    await expect(
      w.linkNote.execute(member, {
        noteId: note.id,
        target: { entityType: 'INVOICE', entityId: 'inv_old' },
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      w.linkNote.execute(member, {
        noteId: note.id,
        target: { entityType: 'PAYMENT', entityId: 'pay_1' },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { entityType: ['validation.invalidOption'] },
    });
  });
});

describe('UnlinkNote', () => {
  it('unlinks one of several links and refuses to remove the last one', async () => {
    const { w, note, base } = await withNote();
    const unlinked = await w.unlinkNote.execute(member, { noteId: note.id, target: KAIROS });
    expect(unlinked.links.map((l) => l.id)).toEqual(['pry_kairos_web']);
    expect(w.activity.entries.slice(base)).toMatchObject([
      {
        action: 'UNLINK',
        clientId: 'cli_kairos',
        metadata: { entityType: 'CLIENT', entityId: 'cli_kairos' },
      },
    ]);
    await expect(
      w.unlinkNote.execute(member, { noteId: note.id, target: KAIROS_WEB }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_LOCK', message: 'notes.errors.lastLink' });
    await expect(
      w.unlinkNote.execute(member, { noteId: note.id, target: ANA }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('AttachNoteFile', () => {
  it('attaches a READY file once and records UPLOAD with the file name', async () => {
    const { w, note, base } = await withNote();
    w.seedFile('fil_brief', member);
    const attached = await w.attachFile.execute(member, { noteId: note.id, fileId: 'fil_brief' });
    expect(attached.attachments.map((f) => f.id)).toEqual(['fil_brief']);
    await w.attachFile.execute(member, { noteId: note.id, fileId: 'fil_brief' });
    const entries = w.activity.entries.slice(base);
    expect(entries.map((e) => e.action)).toEqual(['UPLOAD']);
    expect(entries[0]?.metadata).toEqual({ fileId: 'fil_brief', fileName: 'fil_brief.pdf' });
    expect(w.fileRepo.locked).toContain('fil_brief');
  });

  it("answers NOT_FOUND for another user's unattached file, a PENDING one and an unknown one", async () => {
    const { w, note } = await withNote();
    w.seedFile('fil_theirs', otherMember);
    w.seedFile('fil_pending', member, 'PENDING');
    for (const fileId of ['fil_theirs', 'fil_pending', 'fil_missing']) {
      await expect(w.attachFile.execute(member, { noteId: note.id, fileId })).rejects.toMatchObject(
        { code: 'NOT_FOUND' },
      );
    }
  });

  it('lets a file already claimed by a note the caller can read be attached to another note', async () => {
    const { w, note } = await withNote();
    w.seedFile('fil_shared', otherMember);
    const theirs = await w.createNote.execute(
      otherMember,
      newNote({ attachmentFileIds: ['fil_shared'] }),
    );
    expect(theirs.attachments).toHaveLength(1);
    const attached = await w.attachFile.execute(member, { noteId: note.id, fileId: 'fil_shared' });
    expect(attached.attachments.map((f) => f.id)).toEqual(['fil_shared']);
  });
});
