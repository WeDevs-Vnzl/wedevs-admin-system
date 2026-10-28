import { describe, expect, it } from 'vitest';
import { nonEmptyRichTextDocSchema, richTextDocSchema } from './rich-text.schema';

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues.map((i) => i.message) ?? [];

describe('richTextDocSchema', () => {
  it('returns the sanitized document (image src dropped)', () => {
    const r = richTextDocSchema.safeParse({
      type: 'doc',
      content: [{ type: 'image', attrs: { fileId: 'f1', src: 'https://evil.example/a.png' } }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.content?.[0]).toEqual({ type: 'image', attrs: { fileId: 'f1' } });
  });

  it('maps unknown nodes and attributes to validation.invalidFormat', () => {
    expect(
      messages(richTextDocSchema.safeParse({ type: 'doc', content: [{ type: 'script' }] })),
    ).toEqual(['validation.invalidFormat']);
    expect(messages(richTextDocSchema.safeParse('x'))).toEqual(['validation.invalidFormat']);
  });

  it('maps an oversized document to validation.tooLong', () => {
    expect(messages(richTextDocSchema.safeParse(textDoc('x'.repeat(500_001))))).toEqual([
      'validation.tooLong',
    ]);
  });
});

describe('nonEmptyRichTextDocSchema', () => {
  it('rejects a blank document with validation.required', () => {
    expect(
      messages(
        nonEmptyRichTextDocSchema.safeParse({ type: 'doc', content: [{ type: 'paragraph' }] }),
      ),
    ).toEqual(['validation.required']);
    expect(messages(nonEmptyRichTextDocSchema.safeParse(textDoc('   ')))).toEqual([
      'validation.required',
    ]);
  });
  it('accepts a document with content', () => {
    expect(nonEmptyRichTextDocSchema.safeParse(textDoc('hola')).success).toBe(true);
  });
});
