import { describe, expect, it } from 'vitest';
import {
  ANA,
  KAIROS,
  KAIROS_WEB,
  SOLARIS,
  admin,
  doc,
  member,
  newNote,
  otherMember,
  query,
  seededWorld,
  viewer,
} from '../../../../../test/commercial/notes/world';

async function populated() {
  const w = seededWorld();
  w.seedTag('tag_urgente', 'Urgente');
  w.seedTag('tag_prio', 'Prioritario');
  const create = async (user: typeof member, over: Record<string, unknown>) => {
    w.clock.advance(60_000);
    return w.createNote.execute(user, newNote(over));
  };
  const alcance = await create(member, {
    title: 'Alcance acordado',
    links: [KAIROS, KAIROS_WEB],
    tagIds: ['tag_prio'],
  });
  const riesgo = await create(otherMember, {
    title: 'Riesgo',
    content: doc('Integración de pagos con retraso'),
    links: [KAIROS_WEB],
    tagIds: ['tag_urgente'],
  });
  const solaris = await create(member, { title: 'Minuta', links: [SOLARIS] });
  const contacto = await create(member, { title: 'Contacto', links: [ANA], pinned: true });
  w.clock.advance(60_000);
  return { w, alcance, riesgo, solaris, contacto };
}
const ids = (page: { items: { id: string }[] }) => page.items.map((row) => row.id);

describe('ListNotes', () => {
  it('lists the table newest first and assembles rows: excerpt, author, tags, links, attachment count', async () => {
    const { w, alcance, contacto } = await populated();
    const page = await w.listNotes.execute(viewer, query());
    expect(page.total).toBe(4);
    expect(page.items[0]?.id).toBe(contacto.id);
    const row = page.items.find((r) => r.id === alcance.id);
    expect(row).toMatchObject({
      title: 'Alcance acordado',
      excerpt: 'texto',
      author: { id: member.userId },
      attachmentCount: 0,
      tags: [{ id: 'tag_prio', name: 'Prioritario' }],
    });
    expect(row?.links.map((l) => l.type)).toEqual(['CLIENT', 'PROJECT']);
  });

  it('feeds one record with pinned notes first, then the newest', async () => {
    const { w, alcance, riesgo } = await populated();
    const feed = await w.listNotes.execute(
      member,
      query({ filters: { entityType: 'PROJECT', entityId: 'pry_kairos_web' } }),
    );
    expect(ids(feed)).toEqual([riesgo.id, alcance.id]);
    await w.pinNote.execute(member, { id: alcance.id, pinned: true });
    const pinned = await w.listNotes.execute(
      member,
      query({ filters: { entityType: 'PROJECT', entityId: 'pry_kairos_web' } }),
    );
    expect(ids(pinned)).toEqual([alcance.id, riesgo.id]);
  });

  it('filters by author, tag, linked type, pinned, dates and text', async () => {
    const { w, alcance, riesgo, contacto } = await populated();
    const run = async (filters: Record<string, string | string[]>, q?: string) =>
      ids(await w.listNotes.execute(member, query({ filters, ...(q ? { q } : {}) })));
    expect(await run({ authorId: otherMember.userId })).toEqual([riesgo.id]);
    expect(await run({ tagId: 'tag_urgente' })).toEqual([riesgo.id]);
    expect(await run({ linkedEntityType: 'CONTACT' })).toEqual([contacto.id]);
    expect(await run({ pinned: 'true' })).toEqual([contacto.id]);
    expect(await run({ pinned: 'false' })).toHaveLength(3);
    expect(await run({}, 'integracion de pagos')).toEqual([riesgo.id]);
    expect(await run({}, 'alcance')).toEqual([alcance.id]);
    expect(await run({ createdFrom: '2026-10-30', createdTo: '2026-10-30' })).toHaveLength(4);
    expect(await run({ createdFrom: '2026-10-31' })).toEqual([]);
    expect(await run({ createdTo: '2026-10-29' })).toEqual([]);
  });

  it('turns Caracas calendar days into UTC bounds (UTC-4)', async () => {
    const { w } = await populated();
    const spy: Date[] = [];
    const original = w.notes.list.bind(w.notes);
    w.notes.list = async (criteria) => {
      spy.push(criteria.createdFrom as Date, criteria.createdBefore as Date);
      return original(criteria);
    };
    await w.listNotes.execute(
      member,
      query({ filters: { createdFrom: '2026-10-30', createdTo: '2026-10-30' } }),
    );
    expect(spy.map((d) => d.toISOString())).toEqual([
      '2026-10-30T04:00:00.000Z',
      '2026-10-31T04:00:00.000Z',
    ]);
  });

  it('rejects malformed filters with field keys', async () => {
    const { w } = await populated();
    const run = (filters: Record<string, string>) =>
      w.listNotes.execute(member, query({ filters }));
    await expect(run({ entityType: 'CLIENT' })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { entityId: ['validation.required'] },
    });
    await expect(run({ entityId: 'cli_kairos' })).rejects.toMatchObject({
      fieldErrors: { entityType: ['validation.required'] },
    });
    await expect(run({ entityType: 'TAG', entityId: 'x' })).rejects.toMatchObject({
      fieldErrors: { entityType: ['validation.invalidOption'] },
    });
    await expect(run({ createdFrom: '2026-13-01' })).rejects.toMatchObject({
      fieldErrors: { createdFrom: ['validation.date.invalid'] },
    });
    await expect(run({ pinned: 'maybe' })).rejects.toMatchObject({
      fieldErrors: { pinned: ['validation.invalidOption'] },
    });
    await expect(run({ linkedEntityType: 'TAG' })).rejects.toMatchObject({
      fieldErrors: { linkedEntityType: ['validation.invalidOption'] },
    });
  });

  it('shows archived notes only to the trash roles; others get the live ones (C19)', async () => {
    const { w, riesgo } = await populated();
    await w.archiveNote.execute(admin, { id: riesgo.id });
    const asAdmin = await w.listNotes.execute(admin, query({ archived: 'include' }));
    expect(ids(asAdmin)).toContain(riesgo.id);
    expect(ids(await w.listNotes.execute(admin, query({ archived: 'only' })))).toEqual([riesgo.id]);
    for (const user of [member, viewer]) {
      const page = await w.listNotes.execute(user, query({ archived: 'only' }));
      expect(ids(page)).not.toContain(riesgo.id);
      expect(page.total).toBe(3);
    }
  });
});

describe('GetNote', () => {
  it('returns the detail with plain text, tags, links and attachments', async () => {
    const { w, alcance } = await populated();
    const note = await w.getNote.execute(viewer, { id: alcance.id });
    expect(note).toMatchObject({
      id: alcance.id,
      contentText: 'texto',
      tags: [{ id: 'tag_prio' }],
      archivedAt: null,
    });
    expect(note.links).toHaveLength(2);
  });

  it('answers NOT_FOUND for an unknown id and for an archived note to non-trash roles (F6)', async () => {
    const { w, alcance } = await populated();
    await expect(w.getNote.execute(member, { id: 'not_nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await w.archiveNote.execute(admin, { id: alcance.id });
    await expect(w.getNote.execute(admin, { id: alcance.id })).resolves.toMatchObject({
      id: alcance.id,
    });
    for (const user of [member, viewer]) {
      await expect(w.getNote.execute(user, { id: alcance.id })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    }
  });
});
