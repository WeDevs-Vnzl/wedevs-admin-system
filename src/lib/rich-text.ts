/**
 * Pure helpers over Tiptap JSON (PRD §8.10). Canonical copies for `src/` (lib never imports `@/mocks`):
 * `richTextToPlainText` and `noteDisplayTitle` keep the semantics of `src/mocks/entity-refs.ts`, so a
 * note's card title and its `EntityRef` label agree.
 */

export interface RichTextLike {
  text?: string | undefined;
  content?: readonly unknown[] | undefined;
}

/** Words of the content used as the title of an untitled note (same count as `resolveEntityRef`). */
export const NOTE_TITLE_WORDS = 6;

/** Plain-text projection of a Tiptap node: text nodes, blocks joined by one space. */
export function richTextToPlainText(node: RichTextLike): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? [])
    .map((child) => richTextToPlainText(child as RichTextLike))
    .filter((part) => part.length > 0)
    .join(" ");
}

/** First `count` words of `value`. */
export function firstWords(value: string, count: number = NOTE_TITLE_WORDS): string {
  return value.trim().split(/\s+/).slice(0, count).join(" ");
}

/** First `max` characters of the plain text, cut at a word boundary when possible and ended with `…`. */
export function richTextExcerpt(doc: RichTextLike, max: number): string {
  const text = richTextToPlainText(doc).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** The title of a note, or its first words when it has none (PRD §8.10). Empty when both are blank. */
export function noteDisplayTitle(title: string | null | undefined, doc: RichTextLike): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return firstWords(richTextToPlainText(doc));
}
