import { describe, expect, it } from 'vitest';
import {
  KAIROS,
  KAIROS_WEB,
  admin,
  doc,
  imageDoc,
  member,
  newNote,
  otherMember,
  seededWorld,
  viewer,
} from '../../../../../test/commercial/notes/world';

async function withNote(over: Record<string, unknown> = {}) {
  const w = seededWorld();
  w.seedTag('tag_a', 'Prioritario');
  w.seedTag('tag_b', 'Urgente');
  const note = await w.createNote.execute(
    member,
    newNote({ title: 'Alcance acordado', links: [KAIROS, KAIROS_WEB], ...over }),
  );
  return { w, note };
}

describe('UpdateNote', () => {
  it('keeps the author, records the content as "changed" and the title pair, bumps updatedAt', async () => {
    const { w, note } = await withNote();
    w.clock.advance(60_000);
    const updated = await w.updateNote.execute(admin, {
      id: note.id,
      title: 'Nuevo título',
      content: doc('contenido nuevo'),
      tagIds: ['tag_a'],
    });
    expect(updated.author.id).toBe(member.userId);
    expect(updated.title).toBe('Nuevo título');
    expect(updated.updatedAt).toEqual(w.clock.now());
    const entry = w.activity.entries.at(-1);
    expect(entry).toMatchObject({ action: 'UPDATE', clientId: 'cli_kairos' });
    expect(entry?.changes).toEqual({
      title: ['Alcance acordado', 'Nuevo título'],
      content: 'changed',
      tagIds: ['', 'Prioritario'],
    });
    expect(w.search.get('NOTE', note.id)).toMatchObject({
      title: 'Nuevo título',
      body: 'contenido nuevo',
    });
  });

  it('logs sorted tag names joined with ", ", never ids (CR-B4)', async () => {
    const { w, note } = await withNote();
    await w.updateNote.execute(member, {
      id: note.id,
      title: 'Alcance acordado',
      content: doc('texto'),
      tagIds: ['tag_b', 'tag_a'],
    });
    const changes = w.activity.entries.at(-1)?.changes;
    expect(changes).toEqual({ tagIds: ['', 'Prioritario, Urgente'] });
    expect(JSON.stringify(changes)).not.toMatch(/tag_/);
  });

  it('writes and logs nothing when nothing changed', async () => {
    const { w, note } = await withNote();
    const before = w.activity.entries.length;
    await w.updateNote.execute(member, {
      id: note.id,
      title: note.title,
      content: note.content,
      tagIds: [],
    });
    expect(w.activity.entries).toHaveLength(before);
  });

  it('reserves images new to the content as attachments and refuses unknown or foreign files', async () => {
    const { w, note } = await withNote();
    w.seedFile('fil_img', member);
    w.seedFile('fil_theirs', otherMember);
    const base = { id: note.id, title: 'Nota', tagIds: [] as string[] };
    await expect(
      w.updateNote.execute(member, { ...base, content: imageDoc('fil_missing') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      w.updateNote.execute(member, { ...base, content: imageDoc('fil_theirs') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const updated = await w.updateNote.execute(member, { ...base, content: imageDoc('fil_img') });
    expect(updated.attachments.map((f) => f.id)).toEqual(['fil_img']);
  });

  it('answers NOT_FOUND for an archived or unknown note and FORBIDDEN to a Viewer', async () => {
    const { w, note } = await withNote();
    const input = { id: note.id, title: 'x', content: doc('x'), tagIds: [] as string[] };
    await expect(w.updateNote.execute(viewer, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(w.updateNote.execute(member, { ...input, id: 'not_nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await w.archiveNote.execute(admin, { id: note.id });
    await expect(w.updateNote.execute(member, input)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
