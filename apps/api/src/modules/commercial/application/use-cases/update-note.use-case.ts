import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { SearchIndexPort } from '../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import { noteChanges, normalizeNoteTitle, prepareNoteContent } from '../../domain/note';
import type { NoteAttachmentFilesPort } from '../ports/note-attachment-files.port';
import type { NoteRepository } from '../ports/note.repository.port';
import {
  noteActivity,
  noteSearchEntry,
  noteTagTarget,
  reserveFiles,
  type NoteDetail,
  type NoteViews,
} from './note-support';

export interface UpdateNoteInput {
  readonly id: string;
  readonly title?: string | null;
  readonly content: unknown;
  readonly tagIds: readonly string[];
}

/**
 * `PATCH /notes/{id}`: title, content and tags (the author never changes). Images new to the content
 * are reserved as attachments (C23). Records `UPDATE` with the diff (content as "changed") and reindexes
 * only when something changed; otherwise nothing is written.
 */
export class UpdateNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly files: NoteAttachmentFilesPort,
    private readonly tags: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly search: SearchIndexPort,
    private readonly views: NoteViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: UpdateNoteInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'update', 'note');
    const title = normalizeNoteTitle(input.title);
    const prepared = prepareNoteContent(input.content);

    await this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.id);
      if (!note || note.deletedAt) throw new NotFoundError();

      const attached = new Set(note.attachments.map((file) => file.id));
      const added = await reserveFiles(
        this.files,
        actor,
        prepared.imageFileIds.filter((id) => !attached.has(id)),
      );

      const target = noteTagTarget(note.id);
      const before = await this.tagNames(target);
      await this.tags.replace(actor, target, input.tagIds);
      const after = await this.tagNames(target);

      const changes = noteChanges(
        { title: note.title, content: note.content, tagNames: before },
        { title, content: prepared.content, tagNames: after },
      );
      if (!changes) return;

      const at = this.clock.now();
      await this.notes.updateContent(note.id, {
        title,
        content: prepared.content,
        contentText: prepared.contentText,
        updatedAt: at,
      });
      if (added.length > 0) {
        await this.notes.addAttachments(
          note.id,
          added.map((file) => file.id),
          at,
        );
      }
      const updated = { id: note.id, title, content: prepared.content };
      await this.activityLog.record(
        noteActivity(actor, updated, note.links, 'UPDATE', { changes }),
      );
      await this.search.upsert(
        noteSearchEntry({ ...updated, contentText: prepared.contentText }, false),
      );
    });

    const note = await this.notes.findById(input.id);
    if (!note) throw new NotFoundError();
    return this.views.detail(note);
  }

  private async tagNames(target: ReturnType<typeof noteTagTarget>): Promise<string[]> {
    const chips = await this.tags.chipsFor([target]);
    return (chips.get(`NOTE:${target.entityId}`) ?? []).map((chip) => chip.name);
  }
}
