import { describe, expect, it } from 'vitest';
import {
  RICH_TEXT_MAX_BYTES,
  firstWords,
  imageFileIds,
  noteDisplayTitle,
  richTextExcerpt,
  richTextHasContent,
  richTextToPlainText,
  sanitizeRichTextDoc,
} from './rich-text';

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Alcance' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'uno dos tres ' },
        { type: 'text', text: 'cuatro', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' cinco seis siete ocho' },
      ],
    },
  ],
};

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const image = (attrs: unknown) => ({ type: 'doc', content: [{ type: 'image', attrs }] });
const withMark = (mark: unknown) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [mark] }] }],
});
const ok = (input: unknown) => sanitizeRichTextDoc(input).ok;

describe('plain text helpers (port of fe/src/lib/rich-text.ts)', () => {
  it('joins text nodes of a block and blocks with one space', () => {
    expect(richTextToPlainText(doc)).toBe('Alcance uno dos tres  cuatro  cinco seis siete ocho');
  });
  it('is empty for an empty document', () => {
    expect(richTextToPlainText({ content: [] })).toBe('');
  });
  it('excerpt returns the whole text when it fits', () => {
    expect(richTextExcerpt({ content: [{ type: 'text', text: 'hola  mundo' }] } as never, 50)).toBe(
      'hola mundo',
    );
  });
  it('excerpt cuts at a word boundary and adds an ellipsis', () => {
    expect(richTextExcerpt(doc, 20)).toBe('Alcance uno dos…');
  });
  it('excerpt cuts mid-word when there is no usable boundary', () => {
    expect(
      richTextExcerpt({ content: [{ type: 'text', text: 'abcdefghijklmnop' }] } as never, 5),
    ).toBe('abcde…');
  });
  it('noteDisplayTitle prefers the title and falls back to the first six words', () => {
    expect(noteDisplayTitle('  Mi nota ', doc)).toBe('Mi nota');
    expect(noteDisplayTitle(null, doc)).toBe('Alcance uno dos tres cuatro cinco');
    expect(noteDisplayTitle('   ', doc)).toBe('Alcance uno dos tres cuatro cinco');
    expect(firstWords('a b c', 2)).toBe('a b');
  });
});

describe('sanitizeRichTextDoc allowlist (port of fe/src/lib/validators/notes.ts)', () => {
  it('accepts headings, lists, task lists, code, quotes, tables, images and marks', () => {
    const rich = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Título' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno' }] }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1' }] },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'enlace',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
            { type: 'text', text: 'negrita', marks: [{ type: 'bold' }] },
          ],
        },
        { type: 'image', attrs: { fileId: 'file_1', alt: 'captura' } },
      ],
    };
    expect(ok(rich)).toBe(true);
  });

  it('rejects node types outside the allowlist (script, iframe...)', () => {
    for (const type of ['script', 'iframe', 'html', 'style']) {
      expect(ok({ type: 'doc', content: [{ type }] }), type).toBe(false);
    }
    expect(ok({ type: 'paragraph' })).toBe(false);
    expect(ok(null)).toBe(false);
  });

  it('rejects mark types outside the allowlist and unsafe link hrefs', () => {
    expect(ok(withMark({ type: 'highlightHtml' }))).toBe(false);
    for (const href of ['javascript:alert(1)', 'data:text/html,x', '//evil.com', undefined]) {
      expect(ok(withMark({ type: 'link', attrs: { href } })), String(href)).toBe(false);
    }
    expect(ok(withMark({ type: 'link', attrs: { href: 'mailto:ana@example.com' } }))).toBe(true);
  });

  it('rejects an event-handler attribute on any node or mark', () => {
    expect(ok({ type: 'doc', content: [{ type: 'paragraph', attrs: { onerror: 'x()' } }] })).toBe(
      false,
    );
    expect(
      ok(withMark({ type: 'link', attrs: { href: 'https://a.example', onclick: 'x()' } })),
    ).toBe(false);
  });

  it('images: drops src, keeps fileId and alt, rejects any other attribute', () => {
    for (const src of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://evil.example.com/a.png',
      '/api/files/fil_0001/download',
    ]) {
      const result = sanitizeRichTextDoc(image({ fileId: 'fil_0001', alt: 'x', src }));
      expect(result.ok, src).toBe(true);
      if (result.ok) {
        expect(result.doc.content?.[0]).toEqual({
          type: 'image',
          attrs: { fileId: 'fil_0001', alt: 'x' },
        });
      }
    }
    expect(ok(image({ alt: 'x' }))).toBe(false);
    expect(ok({ type: 'doc', content: [{ type: 'image' }] })).toBe(false);
    expect(ok(image({ fileId: 'fil_1', alt: 'a'.repeat(201) }))).toBe(false);
    expect(ok(image({ fileId: 'fil_1', onerror: 'x()' }))).toBe(false);
    expect(ok(image({ fileId: 'fil_1', srcset: 'a 1x' }))).toBe(false);
  });

  it('caps the serialized size at 500 000 bytes', () => {
    expect(RICH_TEXT_MAX_BYTES).toBe(500_000);
    const big = sanitizeRichTextDoc(textDoc('x'.repeat(RICH_TEXT_MAX_BYTES)));
    expect(big).toEqual({ ok: false, reason: 'tooLong' });
    expect(ok(textDoc('x'.repeat(1000)))).toBe(true);
  });

  it('does not mutate the input', () => {
    const input = image({ fileId: 'f1', src: 'https://x.example/a.png' });
    sanitizeRichTextDoc(input);
    expect(JSON.stringify(input)).toContain('https://x.example/a.png');
  });
});

describe('richTextHasContent', () => {
  it('tells blank documents from real ones', () => {
    expect(richTextHasContent({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false);
    expect(richTextHasContent(textDoc('   '))).toBe(false);
    expect(richTextHasContent(textDoc('hola'))).toBe(true);
    expect(richTextHasContent({ type: 'doc', content: [{ type: 'image' }] })).toBe(true);
  });
});

describe('imageFileIds', () => {
  it('collects the fileId of every image node, nested ones included', () => {
    const d = {
      type: 'doc' as const,
      content: [
        { type: 'image' as const, attrs: { fileId: 'a' } },
        {
          type: 'blockquote' as const,
          content: [{ type: 'image' as const, attrs: { fileId: 'b' } }],
        },
      ],
    };
    expect(imageFileIds(d)).toEqual(['a', 'b']);
    expect(imageFileIds(textDoc('x') as never)).toEqual([]);
  });
});
