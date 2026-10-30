import { describe, expect, it } from 'vitest';
import {
  ANA,
  KAIROS,
  KAIROS_WEB,
  SOLARIS,
  doc,
  imageDoc,
  member,
  newNote,
  otherMember,
  seededWorld,
  viewer,
} from '../../../../../test/commercial/notes/world';

describe('CreateNote', () => {
  it('sets the author from the caller, resolves the links and records CREATE + one LINK per target', async () => {
    const w = seededWorld();
    w.seedFile('fil_logo', member);
    const note = await w.createNote.execute(
      member,
      newNote({
        title: undefined,
        content: doc('uno dos tres cuatro cinco seis siete'),
        links: [KAIROS, KAIROS_WEB],
        attachmentFileIds: ['fil_logo'],
      }),
    );
    expect(note.author).toEqual({ id: member.userId, name: member.name, imageUrl: null });
    expect(note.links.map((l) => l.id)).toEqual(['cli_kairos', 'pry_kairos_web']);
    expect(note.attachments.map((f) => f.id)).toEqual(['fil_logo']);
    expect(note.contentText).toBe('uno dos tres cuatro cinco seis siete');
    expect(note.createdAt).toEqual(w.clock.now());

    const entries = w.activity.entries;
    expect(entries.map((e) => e.action)).toEqual(['CREATE', 'LINK', 'LINK']);
    expect(entries[0]).toMatchObject({
      entityType: 'NOTE',
      entityId: note.id,
      entityLabel: 'uno dos tres cuatro cinco seis',
      actor: { actorType: 'USER', userId: member.userId },
      clientId: 'cli_kairos',
      touchClientIds: ['cli_kairos'],
    });
    expect(entries[2]?.metadata).toEqual({ entityType: 'PROJECT', entityId: 'pry_kairos_web' });
  });

  it('indexes the note: title, plain text as the body (HU-23 CA3)', async () => {
    const w = seededWorld();
    const note = await w.createNote.execute(member, newNote({ title: 'Alcance' }));
    expect(w.search.get('NOTE', note.id)).toEqual({
      entityType: 'NOTE',
      entityId: note.id,
      code: null,
      title: 'Alcance',
      subtitle: null,
      body: 'texto',
      status: null,
      archived: false,
    });
  });

  it('links a client and a project at once and touches every client target (CA2)', async () => {
    const w = seededWorld();
    await w.createNote.execute(member, newNote({ links: [SOLARIS, KAIROS_WEB, KAIROS, ANA] }));
    expect(w.activity.entries[0]).toMatchObject({
      clientId: 'cli_solaris',
      touchClientIds: ['cli_solaris', 'cli_kairos'],
    });
  });

  it('assigns the tags (CA1) and refuses an unknown tag', async () => {
    const w = seededWorld();
    w.seedTag('tag_a', 'Prioritario');
    await w.createNote.execute(member, newNote({ tagIds: ['tag_a'] }));
    expect(w.assignmentRepo.committedIds({ entityType: 'NOTE', entityId: 'not_1' })).toEqual([
      'tag_a',
    ]);
    await expect(
      w.createNote.execute(member, newNote({ tagIds: ['tag_missing'] })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { tagIds: ['validation.invalidOption'] },
    });
    expect(w.notes.rows).toHaveLength(1);
  });

  it('refuses an unknown or archived link target with NOT_FOUND and creates nothing', async () => {
    const w = seededWorld();
    w.targets.archive('CLIENT', 'cli_solaris');
    for (const target of [{ entityType: 'CLIENT', entityId: 'cli_missing' }, SOLARIS]) {
      await expect(
        w.createNote.execute(member, newNote({ links: [target] })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(w.notes.rows).toHaveLength(0);
    expect(w.activity.entries).toHaveLength(0);
  });

  it('refuses a type nobody registered, repeated targets and a note without links', async () => {
    const w = seededWorld();
    await expect(
      w.createNote.execute(
        member,
        newNote({ links: [{ entityType: 'INVOICE', entityId: 'inv_1' }] }),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { 'links.0.entityType': ['validation.invalidOption'] },
    });
    await expect(
      w.createNote.execute(member, newNote({ links: [KAIROS, KAIROS] })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { links: ['validation.invalidOption'] },
    });
    await expect(w.createNote.execute(member, newNote({ links: [] }))).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { links: ['validation.required'] },
    });
  });

  it('claims the attachments through platform: READY files of the caller only', async () => {
    const w = seededWorld();
    w.seedFile('fil_pending', member, 'PENDING');
    w.seedFile('fil_theirs', otherMember);
    for (const fileId of ['fil_pending', 'fil_missing', 'fil_theirs']) {
      await expect(
        w.createNote.execute(member, newNote({ attachmentFileIds: [fileId] })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    expect(w.notes.rows).toHaveLength(0);
    expect(w.search.size).toBe(0);
  });

  it('turns every image node into an attachment of the note and drops its src', async () => {
    const w = seededWorld();
    w.seedFile('fil_img', member);
    const note = await w.createNote.execute(
      member,
      newNote({
        content: imageDoc('fil_img', { src: 'https://evil.test/x.png', alt: 'logo' }),
        attachmentFileIds: ['fil_img'],
      }),
    );
    expect(note.attachments.map((f) => f.id)).toEqual(['fil_img']);
    expect(note.content.content?.[1]?.attrs).toEqual({ fileId: 'fil_img', alt: 'logo' });
    expect(w.fileRepo.locked).toEqual(['fil_img']);
  });

  it('reserves files in id order so concurrent notes never deadlock', async () => {
    const w = seededWorld();
    w.seedFile('fil_b', member);
    w.seedFile('fil_a', member);
    await w.createNote.execute(member, newNote({ attachmentFileIds: ['fil_b', 'fil_a'] }));
    expect(w.fileRepo.locked).toEqual(['fil_a', 'fil_b']);
  });

  it('rejects markup outside the allowlist and blank content before touching anything', async () => {
    const w = seededWorld();
    const bad = [
      { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] },
      {
        type: 'doc',
        content: [{ type: 'image', attrs: { fileId: 'f', onerror: 'alert(1)' } }],
      },
      {
        type: 'doc',
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ],
      },
      doc('   '),
    ];
    for (const content of bad) {
      await expect(w.createNote.execute(member, newNote({ content }))).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    }
    expect(w.notes.rows).toHaveLength(0);
    expect(w.fileRepo.locked).toEqual([]);
  });

  it('lets a Viewer read notes but not create them', async () => {
    const w = seededWorld();
    await expect(w.createNote.execute(viewer, newNote())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(w.notes.rows).toHaveLength(0);
  });
});
