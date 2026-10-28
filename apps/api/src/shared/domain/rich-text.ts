/**
 * Rich text (Tiptap JSON) model for notes and project descriptions (PRD §8.10, C4). Pure domain: the
 * allowlist of `fe/src/lib/validators/notes.ts`, the plain-text helpers of `fe/src/lib/rich-text.ts`
 * and the server-side sanitizer. Zod lives in `shared/interface/rich-text.schema.ts`.
 */

export const RICH_TEXT_NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'image',
] as const;

export const RICH_TEXT_MARK_TYPES = ['bold', 'italic', 'strike', 'code', 'link'] as const;

/** Serialized size cap of one rich-text document. */
export const RICH_TEXT_MAX_BYTES = 500_000;

/** Words of the content used as the title of an untitled note. */
export const NOTE_TITLE_WORDS = 6;

const MAX_DEPTH = 64;
const MAX_ALT = 200;
const MAX_HREF = 2048;

export type RichTextNodeType = (typeof RICH_TEXT_NODE_TYPES)[number];
export type RichTextMarkType = (typeof RICH_TEXT_MARK_TYPES)[number];

export interface RichTextMark {
  type: RichTextMarkType;
  attrs?: Record<string, unknown>;
}

export interface RichTextNode {
  type: RichTextNodeType;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

export interface RichTextDoc {
  type: 'doc';
  content?: RichTextNode[];
}

export type RichTextIssue = 'invalidFormat' | 'tooLong';

export type SanitizedRichText =
  | { readonly ok: true; readonly doc: RichTextDoc }
  | { readonly ok: false; readonly reason: RichTextIssue };

export interface RichTextLike {
  text?: string | undefined;
  content?: readonly unknown[] | undefined;
}

// ───────────────────────────── plain text ─────────────────────────────

/** Plain-text projection of a Tiptap node: text nodes, blocks joined by one space. */
export function richTextToPlainText(node: RichTextLike): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? [])
    .map((child) => richTextToPlainText(child as RichTextLike))
    .filter((part) => part.length > 0)
    .join(' ');
}

/** First `count` words of `value`. */
export function firstWords(value: string, count: number = NOTE_TITLE_WORDS): string {
  return value.trim().split(/\s+/).slice(0, count).join(' ');
}

/** First `max` characters of the plain text, cut at a word boundary when possible and ended with `…`. */
export function richTextExcerpt(doc: RichTextLike, max: number): string {
  const text = richTextToPlainText(doc).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** The title of a note, or its first words when it has none. Empty when both are blank. */
export function noteDisplayTitle(title: string | null | undefined, doc: RichTextLike): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  return firstWords(richTextToPlainText(doc));
}

/** `true` when the document has visible text or an image (an empty paragraph is not content). */
export function richTextHasContent(node: {
  type?: string;
  text?: string | undefined;
  content?: readonly unknown[] | undefined;
}): boolean {
  if (node.type === 'text') return (node.text ?? '').trim().length > 0;
  if (node.type === 'image' || node.type === 'horizontalRule') return true;
  return (node.content ?? []).some((child) =>
    richTextHasContent(child as Parameters<typeof richTextHasContent>[0]),
  );
}

/** File ids referenced by the `image` nodes of a document, in document order. */
export function imageFileIds(doc: RichTextLike): string[] {
  const ids: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const n = node as { type?: unknown; attrs?: { fileId?: unknown }; content?: unknown };
    if (n.type === 'image' && typeof n.attrs?.fileId === 'string') ids.push(n.attrs.fileId);
    if (Array.isArray(n.content)) n.content.forEach(visit);
  };
  visit(doc);
  return ids;
}

// ───────────────────────────── sanitizer ─────────────────────────────

type AttrRule = (value: unknown) => boolean;
const isInt =
  (min: number, max: number): AttrRule =>
  (v) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isBool: AttrRule = (v) => typeof v === 'boolean';
const isShortString: AttrRule = (v) => typeof v === 'string' && v.length <= 100;
const isNullable =
  (rule: AttrRule): AttrRule =>
  (v) =>
    v === null || rule(v);
const isColWidth: AttrRule = (v) =>
  v === null ||
  (Array.isArray(v) &&
    v.length <= 100 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n)));

/** Attributes the editor emits per node type; anything else is rejected. `image` is handled apart. */
const NODE_ATTRS: Partial<Record<RichTextNodeType, Record<string, AttrRule>>> = {
  heading: { level: isInt(1, 6) },
  orderedList: { start: isInt(0, 1_000_000), type: isNullable(isShortString) },
  taskItem: { checked: isBool },
  codeBlock: { language: isNullable(isShortString) },
  tableCell: { colspan: isInt(1, 1000), rowspan: isInt(1, 1000), colwidth: isColWidth },
  tableHeader: { colspan: isInt(1, 1000), rowspan: isInt(1, 1000), colwidth: isColWidth },
};

const LINK_ATTRS: Record<string, AttrRule> = {
  href: (v) => typeof v === 'string' && isSafeHref(v),
  target: isNullable(isShortString),
  rel: isNullable(isShortString),
  class: isNullable(isShortString),
};

function isSafeHref(href: string): boolean {
  if (href.length > MAX_HREF) return false;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return true;
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const NODE_TYPE_SET: ReadonlySet<string> = new Set(RICH_TEXT_NODE_TYPES);
const MARK_TYPE_SET: ReadonlySet<string> = new Set(RICH_TEXT_MARK_TYPES);

class Invalid extends Error {}
const fail = (): never => {
  throw new Invalid();
};

function cleanAttrs(
  attrs: unknown,
  rules: Record<string, AttrRule>,
  required: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (attrs === undefined || attrs === null) {
    if (required.length > 0) fail();
    return undefined;
  }
  if (!isRecord(attrs)) return fail();
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const rule = rules[key];
    if (!rule || !rule(value)) fail();
    out[key] = value;
  }
  for (const key of required) if (!(key in out)) fail();
  return out;
}

function cleanMark(raw: unknown): RichTextMark {
  if (!isRecord(raw) || typeof raw.type !== 'string' || !MARK_TYPE_SET.has(raw.type)) fail();
  const mark = raw as { type: RichTextMarkType; attrs?: unknown };
  const attrs = cleanAttrs(
    mark.attrs,
    mark.type === 'link' ? LINK_ATTRS : {},
    mark.type === 'link' ? ['href'] : [],
  );
  return attrs ? { type: mark.type, attrs } : { type: mark.type };
}

function cleanImageAttrs(attrs: unknown): Record<string, unknown> {
  if (!isRecord(attrs)) return fail();
  const { fileId, alt, src, ...rest } = attrs;
  void src; // dropped on write: the FE derives the URL from `fileId` (contract choice 6)
  if (Object.keys(rest).length > 0) fail();
  if (typeof fileId !== 'string' || fileId.length === 0 || fileId.length > 128) fail();
  const out: Record<string, unknown> = { fileId };
  if (alt !== undefined) {
    if (typeof alt !== 'string' || alt.length > MAX_ALT) fail();
    out.alt = alt;
  }
  return out;
}

function cleanNode(raw: unknown, depth: number): RichTextNode {
  if (depth > MAX_DEPTH || !isRecord(raw)) return fail();
  const { type, attrs, content, marks, text, ...rest } = raw;
  if (Object.keys(rest).length > 0) fail();
  if (typeof type !== 'string' || !NODE_TYPE_SET.has(type) || type === 'doc') fail();
  const nodeType = type as RichTextNodeType;
  const node: RichTextNode = { type: nodeType };
  if (nodeType === 'image') node.attrs = cleanImageAttrs(attrs);
  else {
    const cleaned = cleanAttrs(attrs, NODE_ATTRS[nodeType] ?? {});
    if (cleaned) node.attrs = cleaned;
  }
  if (content !== undefined) {
    if (!Array.isArray(content)) fail();
    node.content = (content as unknown[]).map((child) => cleanNode(child, depth + 1));
  }
  if (marks !== undefined) {
    if (!Array.isArray(marks)) fail();
    node.marks = (marks as unknown[]).map(cleanMark);
  }
  if (text !== undefined) {
    if (typeof text !== 'string') fail();
    node.text = text as string;
  }
  return node;
}

/**
 * Validates an untrusted Tiptap document against the editor allowlist and returns a clean copy: only
 * allowlisted nodes, marks and attributes survive, link hrefs must be `http(s):`/`mailto:`, and image
 * nodes keep `fileId` (+ `alt`) only, `src` being dropped (C4, contract choice 6). The input is not
 * mutated. A document over `RICH_TEXT_MAX_BYTES` is `tooLong`; anything else outside the allowlist is
 * `invalidFormat`.
 */
export function sanitizeRichTextDoc(input: unknown): SanitizedRichText {
  if (!isRecord(input) || input.type !== 'doc') return { ok: false, reason: 'invalidFormat' };
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return { ok: false, reason: 'invalidFormat' };
  }
  if (size > RICH_TEXT_MAX_BYTES) return { ok: false, reason: 'tooLong' };
  try {
    const { type, content, ...rest } = input;
    void type;
    if (Object.keys(rest).length > 0) fail();
    const doc: RichTextDoc = { type: 'doc' };
    if (content !== undefined) {
      if (!Array.isArray(content)) fail();
      doc.content = (content as unknown[]).map((child) => cleanNode(child, 1));
    }
    return { ok: true, doc };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: 'invalidFormat' };
    throw error;
  }
}
