import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { NoteAttachmentFilesPort } from '../ports/note-attachment-files.port';
import type { NoteRepository } from '../ports/note.repository.port';
import { noteActivity, reserveFiles, type NoteDetail, type NoteViews } from './note-support';

export interface AttachNoteFileInput {
  readonly noteId: string;
  readonly fileId: string;
}

/**
 * `POST /notes/{id}/attachments`. The file is reserved through platform inside the note's unit of work
 * (row lock, ownership and `READY` checks, C23); a file that is unknown, not ready or somebody else's
 * unattached upload is `NOT_FOUND`. Attaching a file the note already has changes and logs nothing.
 */
export class AttachNoteFile {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly files: NoteAttachmentFilesPort,
    private readonly activityLog: ActivityLogPort,
    private readonly views: NoteViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: AttachNoteFileInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'update', 'note');

    await this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.noteId);
      if (!note || note.deletedAt) throw new NotFoundError();
      const [file] = await reserveFiles(this.files, actor, [input.fileId]);
      if (!file || note.attachments.some((attached) => attached.id === file.id)) return;
      await this.notes.addAttachments(note.id, [file.id], this.clock.now());
      await this.activityLog.record(
        noteActivity(actor, note, note.links, 'UPLOAD', {
          metadata: { fileId: file.id, fileName: file.originalName },
        }),
      );
    });

    const note = await this.notes.findById(input.noteId);
    if (!note) throw new NotFoundError();
    return this.views.detail(note);
  }
}
