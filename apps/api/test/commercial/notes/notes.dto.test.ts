import { describe, expect, it } from 'vitest';
import {
  attachNoteFileDtoSchema,
  createNoteDtoSchema,
  noteLinkTargetSchema,
  noteListQuerySchema,
  updateNoteDtoSchema,
} from '../../../src/modules/commercial/interface/http/dto/notes.dto';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const link = { entityType: 'CLIENT', entityId: 'cli_1' };
const messages = (r: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? [];

describe('notes request DTOs', () => {
  it('create applies defaults and sanitizes the content (image src dropped)', () => {
    const parsed = createNoteDtoSchema.parse({
      content: {
        type: 'doc',
        content: [{ type: 'image', attrs: { fileId: 'fil_1', src: 'https://evil.test/a.png' } }],
      },
      links: [link],
    });
    expect(parsed).toMatchObject({ tagIds: [], pinned: false, attachmentFileIds: [] });
    expect(parsed.content.content?.[0]).toEqual({ type: 'image', attrs: { fileId: 'fil_1' } });
  });

  it('create rejects markup, blank content, no links and an unknown link type with i18n keys', () => {
    expect(
      messages(
        createNoteDtoSchema.safeParse({
          content: { type: 'doc', content: [{ type: 'script' }] },
          links: [link],
        }),
      ),
    ).toContain('content:validation.invalidFormat');
    expect(messages(createNoteDtoSchema.safeParse({ content: doc(' '), links: [link] }))).toContain(
      'content:validation.required',
    );
    expect(messages(createNoteDtoSchema.safeParse({ content: doc('x'), links: [] }))).toContain(
      'links:validation.required',
    );
    expect(
      createNoteDtoSchema.safeParse({
        content: doc('x'),
        links: [{ entityType: 'TAG', entityId: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      createNoteDtoSchema.safeParse({ content: doc('x'), links: [link], title: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });

  it('update, link and attach bodies need their fields', () => {
    expect(updateNoteDtoSchema.parse({ content: doc('x') })).toMatchObject({ tagIds: [] });
    expect(updateNoteDtoSchema.safeParse({}).success).toBe(false);
    expect(noteLinkTargetSchema.safeParse(link).success).toBe(true);
    expect(noteLinkTargetSchema.safeParse({ entityType: 'CLIENT' }).success).toBe(false);
    expect(attachNoteFileDtoSchema.safeParse({ fileId: '' }).success).toBe(false);
  });
});

describe('notes list query', () => {
  it('defaults to newest first, page 1, live notes', () => {
    expect(noteListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: { field: 'createdAt', direction: 'desc' },
      archived: 'exclude',
      filters: {},
    });
  });

  it('collects repeated filters and refuses a sort outside the whitelist', () => {
    const parsed = noteListQuerySchema.parse({
      authorId: ['a', 'b'],
      pinned: 'true',
      sort: 'pinned:desc',
      q: ' riesgo ',
    });
    expect(parsed.filters).toEqual({ authorId: ['a', 'b'], pinned: 'true' });
    expect(parsed.q).toBe('riesgo');
    expect(messages(noteListQuerySchema.safeParse({ sort: 'content:asc' }))).toEqual([
      'sort:validation.sort.invalid',
    ]);
    expect(noteListQuerySchema.safeParse({ pinned: 'maybe' }).success).toBe(false);
    expect(noteListQuerySchema.safeParse({ createdFrom: '2026-02-30' }).success).toBe(false);
  });
});
