import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityEntry } from '../../../../shared/application/ports/activity-log.port';
import type { SearchIndexEntry } from '../../../../shared/application/ports/search-index.port';
import type { ActivityAction } from '../../../../shared/domain/enums';
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import {
  richTextExcerpt,
  richTextToPlainText,
  type RichTextDoc,
} from '../../../../shared/domain/rich-text';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { noteLabel, type NoteAuthor, type NoteFile, type NoteRecord } from '../../domain/note';
import { clientScopeOf, linkKey, type NoteLinkTarget } from '../../domain/note-link';
import type { NoteLinkTargetRegistry } from '../note-link-target.registry';
import type {
  NoteAttachmentFilesPort,
  ReservedNoteFile,
} from '../ports/note-attachment-files.port';

/** Characters of the collapsed card preview. */
export const NOTE_EXCERPT_LENGTH = 240;

export interface NoteTagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface NoteDetail {
  readonly id: string;
  readonly title: string | null;
  readonly content: RichTextDoc;
  readonly contentText: string;
  readonly author: NoteAuthor;
  readonly pinned: boolean;
  readonly tags: readonly NoteTagChip[];
  readonly links: readonly EntityRef[];
  readonly attachments: readonly NoteFile[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

export interface NoteListRow {
  readonly id: string;
  readonly title: string | null;
  readonly excerpt: string;
  readonly author: NoteAuthor;
  readonly pinned: boolean;
  readonly tags: readonly NoteTagChip[];
  readonly links: readonly EntityRef[];
  readonly attachmentCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly archivedAt: Date | null;
}

/** The note as a tag target (`TagAssignments` takes the same shape as settings' `TagTarget`). */
export function noteTagTarget(id: string): { entityType: 'NOTE'; entityId: string } {
  return { entityType: 'NOTE', entityId: id };
}

const tagKey = (id: string): string => `NOTE:${id}`;

/** Builds the output models: tag chips from settings' exported API, link labels from the registry. */
export class NoteViews {
  constructor(
    private readonly tags: TagAssignments,
    private readonly targets: NoteLinkTargetRegistry,
  ) {}

  async detail(note: NoteRecord): Promise<NoteDetail> {
    const [row] = await this.rows([note]);
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      contentText: richTextToPlainText(note.content),
      author: note.author,
      pinned: note.pinned,
      tags: row?.tags ?? [],
      links: row?.links ?? [],
      attachments: note.attachments,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      archivedAt: note.deletedAt,
    };
  }

  async rows(notes: readonly NoteRecord[]): Promise<NoteListRow[]> {
    if (notes.length === 0) return [];
    const chips = await this.tags.chipsFor(notes.map((note) => noteTagTarget(note.id)));
    const resolved = await this.targets.resolve(notes.flatMap((note) => [...note.links]));
    return notes.map((note) => ({
      id: note.id,
      title: note.title,
      excerpt: richTextExcerpt(note.content, NOTE_EXCERPT_LENGTH),
      author: note.author,
      pinned: note.pinned,
      tags: chips.get(tagKey(note.id)) ?? [],
      links: note.links.flatMap((link) => {
        const found = resolved.get(linkKey(link));
        return found ? [found.ref] : [];
      }),
      attachmentCount: note.attachments.length,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      archivedAt: note.deletedAt,
    }));
  }
}

interface LabelledNote {
  readonly id: string;
  readonly title: string | null;
  readonly content: RichTextDoc;
}

/**
 * One activity entry of a note. The client scope follows Q-BE2-2: `clientId` is the first client target,
 * every client target is touched.
 */
export function noteActivity(
  actor: CurrentUser,
  note: LabelledNote,
  links: readonly NoteLinkTarget[],
  action: ActivityAction,
  extra: Pick<ActivityEntry, 'changes' | 'metadata'> = {},
): ActivityEntry {
  const scope = clientScopeOf(links);
  return {
    actor: actorOf(actor),
    action,
    entityType: 'NOTE',
    entityId: note.id,
    entityLabel: noteLabel(note.title, note.content, note.id),
    ...(scope.clientId ? { clientId: scope.clientId, touchClientIds: scope.touchClientIds } : {}),
    ...extra,
  };
}

/** The `SearchEntry` of a note: title or display title, plain text as the body (HU-23 CA3). */
export function noteSearchEntry(
  note: LabelledNote & { readonly contentText: string },
  archived: boolean,
): SearchIndexEntry {
  return {
    entityType: 'NOTE',
    entityId: note.id,
    code: null,
    title: noteLabel(note.title, note.content, note.id),
    subtitle: null,
    body: note.contentText,
    status: null,
    archived,
  };
}

/**
 * Reserves every file for the note, in id order so two notes claiming the same files lock them in the
 * same order and never deadlock (C23). Valid only inside the note's unit of work.
 */
export async function reserveFiles(
  files: NoteAttachmentFilesPort,
  actor: CurrentUser,
  fileIds: readonly string[],
): Promise<ReservedNoteFile[]> {
  const reserved: ReservedNoteFile[] = [];
  for (const id of [...new Set(fileIds)].sort()) reserved.push(await files.reserve(actor, id));
  return reserved;
}
