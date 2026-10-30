import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { NoteRecord } from '../../domain/note';
import type { NoteLinkEntityType, NoteLinkTarget } from '../../domain/note-link';

export const NOTE_REPOSITORY = Symbol('NOTE_REPOSITORY');

/** Sortable fields of the notes list (`pinned` is the feed order: pinned first, then by creation). */
export const NOTE_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'pinned'] as const;
export type NoteSortField = (typeof NOTE_SORT_FIELDS)[number];

/** Filters of `GET /notes`, already validated; `query` carries page, sort, `q` and `archived`. */
export interface NoteListCriteria {
  readonly query: ListQuery;
  readonly authorIds: readonly string[];
  readonly tagIds: readonly string[];
  /** Notes linked to at least one record of these types. */
  readonly linkedEntityTypes: readonly NoteLinkEntityType[];
  /** Feed of one record. */
  readonly entity: NoteLinkTarget | null;
  readonly pinned: boolean | null;
  /** `createdAt >= createdFrom` and `createdAt < createdBefore`. */
  readonly createdFrom: Date | null;
  readonly createdBefore: Date | null;
}

/** A note about to be stored: the author is the caller, links keep their order, files are `READY` ids. */
export interface NewNote {
  readonly id: string;
  readonly title: string | null;
  readonly content: NoteRecord['content'];
  readonly contentText: string;
  readonly authorId: string;
  readonly pinned: boolean;
  readonly links: readonly NoteLinkTarget[];
  readonly attachmentFileIds: readonly string[];
  readonly createdAt: Date;
}

export interface NoteContentUpdate {
  readonly title: string | null;
  readonly content: NoteRecord['content'];
  readonly contentText: string;
  readonly updatedAt: Date;
}

/**
 * `Note`, `NoteLink` and `NoteAttachment` rows. Writes need the caller's unit of work. Reads other than
 * `list` return archived notes too (the use case decides who may see them, C19); `list` follows
 * `criteria.query.archived`.
 */
export interface NoteRepository {
  /** Inserts the note with its links (in order) and attachments. */
  insert(note: NewNote): Promise<void>;
  findById(id: string): Promise<NoteRecord | null>;
  /** `SELECT ... FOR UPDATE` on the note row, then the note: serializes link, unlink, attach and archive. */
  findByIdForUpdate(id: string): Promise<NoteRecord | null>;
  list(criteria: NoteListCriteria): Promise<Paginated<NoteRecord>>;
  updateContent(id: string, update: NoteContentUpdate): Promise<void>;
  setPinned(id: string, pinned: boolean, updatedAt: Date): Promise<void>;
  /** `CONFLICT` (`notes.errors.alreadyLinked`) when the target is already linked. */
  addLink(id: string, target: NoteLinkTarget, at: Date): Promise<void>;
  /** `false` when the note was not linked to the target. */
  removeLink(id: string, target: NoteLinkTarget, at: Date): Promise<boolean>;
  addAttachments(id: string, fileIds: readonly string[], at: Date): Promise<void>;
  archive(id: string, at: Date, byUserId: string): Promise<void>;
  restore(id: string, at: Date): Promise<void>;
  /** Whether a live (non-archived) note has the file attached: what makes a note attachment downloadable. */
  isFileAttachedToLiveNote(fileId: string): Promise<boolean>;
}
