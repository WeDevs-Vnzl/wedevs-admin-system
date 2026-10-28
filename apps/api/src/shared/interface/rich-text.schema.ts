import { z } from 'zod';
import { richTextHasContent, sanitizeRichTextDoc, type RichTextDoc } from '../domain/rich-text';
import { GENERIC_VALIDATION_MESSAGES as M } from './zod-validation';

/**
 * A Tiptap document accepted only if it passes the domain allowlist (C4). The parsed value is the
 * sanitized copy (image `src` dropped); issues carry `validation.*` keys, never translated text.
 */
export const richTextDocSchema = z.unknown().transform((value, ctx): RichTextDoc => {
  const result = sanitizeRichTextDoc(value);
  if (result.ok) return result.doc;
  ctx.addIssue({
    code: 'custom',
    message: result.reason === 'tooLong' ? M.tooLong : M.invalidFormat,
  });
  return z.NEVER;
});

/** A rich-text document with something in it (notes must not be blank). */
export const nonEmptyRichTextDocSchema = richTextDocSchema.refine(richTextHasContent, {
  message: M.required,
});
