import { diffFields, type ActivityChanges } from '../../../shared/domain/activity-diff';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  imageFileIds,
  noteDisplayTitle,
  richTextHasContent,
  richTextToPlainText,
  sanitizeRichTextDoc,
  type RichTextDoc,
} from '../../../shared/domain/rich-text';
import type { NoteLinkTarget } from './note-link';

/** Longest title (FE `optionalText(200)`). */
export const NOTE_TITLE_MAX_LENGTH = 200;

const REQUIRED_KEY = 'validation.required';
const TOO_LONG_KEY = 'validation.tooLong';
const INVALID_FORMAT_KEY = 'validation.invalidFormat';

export interface NoteAuthor {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

/** The attachment as a note shows it: file metadata only, never a storage key or URL. */
export interface NoteFile {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly uploadedById: string;
  readonly createdAt: Date;
}

/** A note with its links and attachments. `links` are in creation order (the first client is the scope). */
export interface NoteRecord {
  readonly id: string;
  readonly title: string | null;
  readonly content: RichTextDoc;
  readonly contentText: string;
  readonly author: NoteAuthor;
  readonly pinned: boolean;
  readonly links: readonly NoteLinkTarget[];
  readonly attachments: readonly NoteFile[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/** Trimmed title, `null` when blank; more than 200 characters is `VALIDATION` on `title`. */
export function normalizeNoteTitle(raw: string | null | undefined): string | null {
  const title = raw?.trim() ?? '';
  if (title.length === 0) return null;
  if (title.length > NOTE_TITLE_MAX_LENGTH) {
    throw new ValidationFailedError({ fieldErrors: { title: [TOO_LONG_KEY] } });
  }
  return title;
}

export interface PreparedNoteContent {
  readonly content: RichTextDoc;
  readonly contentText: string;
  /** `fileId` of every image node, deduplicated, in document order. */
  readonly imageFileIds: readonly string[];
}

/**
 * The only way note content reaches storage (C4, PRD §14): the allowlist check of `sanitizeRichTextDoc`
 * (image `src` dropped, contract choice 6), then the notes' own rule that the text is not blank. The
 * interface layer runs the same check; this repeats it so no caller (MCP, job) can skip it.
 */
export function prepareNoteContent(raw: unknown): PreparedNoteContent {
  const result = sanitizeRichTextDoc(raw);
  if (!result.ok) {
    throw new ValidationFailedError({
      fieldErrors: { content: [result.reason === 'tooLong' ? TOO_LONG_KEY : INVALID_FORMAT_KEY] },
    });
  }
  if (!richTextHasContent(result.doc)) {
    throw new ValidationFailedError({ fieldErrors: { content: [REQUIRED_KEY] } });
  }
  return {
    content: result.doc,
    contentText: richTextToPlainText(result.doc),
    imageFileIds: [...new Set(imageFileIds(result.doc))],
  };
}

/** The title of a note, else its first words, else its id (activity label and search title). */
export function noteLabel(title: string | null, content: RichTextDoc, id: string): string {
  return noteDisplayTitle(title, content) || id;
}

/** What `noteChanges` compares. */
export interface NoteDiffState {
  readonly title: string | null;
  readonly content: RichTextDoc;
  /** Names of the note's tags, never ids (C1). */
  readonly tagNames: readonly string[];
}

function sortedTagNames(names: readonly string[]): string {
  return [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).join(', ');
}

/** `{ field: [before, after] }`; the content is a long text, so only "changed" is recorded (C20). */
export function noteChanges(before: NoteDiffState, after: NoteDiffState): ActivityChanges | null {
  const shape = (state: NoteDiffState) => ({
    title: state.title,
    content: JSON.stringify(state.content),
    tagIds: sortedTagNames(state.tagNames),
  });
  return diffFields(shape(before), shape(after), {
    fields: ['title', 'content', 'tagIds'],
    longText: ['content'],
  });
}
