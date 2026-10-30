import { describe, expect, it } from 'vitest';
import type { RichTextDoc } from '../../../shared/domain/rich-text';
import {
  noteChanges,
  noteLabel,
  normalizeNoteTitle,
  prepareNoteContent,
  type NoteDiffState,
} from './note';

const doc = (text: string): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

describe('normalizeNoteTitle', () => {
  it('trims, turns blank into null and caps at 200 characters', () => {
    expect(normalizeNoteTitle('  Alcance  ')).toBe('Alcance');
    expect(normalizeNoteTitle('   ')).toBeNull();
    expect(normalizeNoteTitle(undefined)).toBeNull();
    expect(normalizeNoteTitle('x'.repeat(200))).toHaveLength(200);
    expect(() => normalizeNoteTitle('x'.repeat(201))).toThrowError(
      expect.objectContaining({
        code: 'VALIDATION',
        fieldErrors: { title: ['validation.tooLong'] },
      }),
    );
  });
});

describe('prepareNoteContent', () => {
  it('returns the sanitized document and its plain text', () => {
    const prepared = prepareNoteContent(doc('hola mundo'));
    expect(prepared.contentText).toBe('hola mundo');
    expect(prepared.content).toEqual(doc('hola mundo'));
  });

  it('drops an image src and keeps fileId', () => {
    const prepared = prepareNoteContent({
      type: 'doc',
      content: [{ type: 'image', attrs: { fileId: 'fil_1', src: 'https://evil.test/x.png' } }],
    });
    expect(prepared.content.content?.[0]?.attrs).toEqual({ fileId: 'fil_1' });
    expect(prepared.imageFileIds).toEqual(['fil_1']);
  });

  it('rejects markup outside the allowlist, blank documents and oversized ones', () => {
    const invalid = { code: 'VALIDATION', fieldErrors: { content: ['validation.invalidFormat'] } };
    expect(() =>
      prepareNoteContent({ type: 'doc', content: [{ type: 'script', text: 'x' }] }),
    ).toThrowError(expect.objectContaining(invalid));
    expect(() =>
      prepareNoteContent({
        type: 'doc',
        content: [{ type: 'image', attrs: { fileId: 'f', onerror: 'alert(1)' } }],
      }),
    ).toThrowError(expect.objectContaining(invalid));
    expect(() => prepareNoteContent(doc('   '))).toThrowError(
      expect.objectContaining({ fieldErrors: { content: ['validation.required'] } }),
    );
    expect(() => prepareNoteContent(doc('x'.repeat(500_001)))).toThrowError(
      expect.objectContaining({ fieldErrors: { content: ['validation.tooLong'] } }),
    );
  });
});

describe('noteLabel', () => {
  it('uses the title, else the first words, else the id', () => {
    expect(noteLabel('Título', doc('uno dos'), 'n1')).toBe('Título');
    expect(noteLabel(null, doc('uno dos tres cuatro cinco seis siete'), 'n1')).toBe(
      'uno dos tres cuatro cinco seis',
    );
    expect(noteLabel(null, { type: 'doc' }, 'n1')).toBe('n1');
  });
});

describe('noteChanges', () => {
  const state = (over: Partial<NoteDiffState> = {}): NoteDiffState => ({
    title: 'A',
    content: doc('x'),
    tagNames: [],
    ...over,
  });

  it('records the title pair, "changed" for the content and sorted tag names', () => {
    const changes = noteChanges(
      state({ tagNames: [] }),
      state({ title: 'B', content: doc('y'), tagNames: ['zeta', 'Alfa'] }),
    );
    expect(changes).toEqual({
      title: ['A', 'B'],
      content: 'changed',
      tagIds: ['', 'Alfa, zeta'],
    });
  });

  it('is null when nothing changed', () => {
    expect(noteChanges(state(), state())).toBeNull();
  });
});
