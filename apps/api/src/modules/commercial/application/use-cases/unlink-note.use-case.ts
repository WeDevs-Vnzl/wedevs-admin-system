import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { IntegrityLockedError, NotFoundError } from '../../../../shared/domain/domain-error';
import { NOTE_LAST_LINK_KEY, sameLink } from '../../domain/note-link';
import type { NoteRepository } from '../ports/note.repository.port';
import { noteActivity, type NoteDetail, type NoteViews } from './note-support';
import type { LinkNoteInput } from './link-note.use-case';

export type UnlinkNoteInput = LinkNoteInput;

/**
 * `POST /notes/{id}/unlink`. A note keeps at least one link: removing the last is `INTEGRITY_LOCK`
 * (`notes.errors.lastLink`); a target the note is not linked to is `NOT_FOUND`. The note row lock makes
 * two concurrent unlinks unable to remove both links.
 */
export class UnlinkNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly views: NoteViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: UnlinkNoteInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'update', 'note');

    await this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.noteId);
      if (!note || note.deletedAt) throw new NotFoundError();
      if (!note.links.some((link) => sameLink(link, input.target))) throw new NotFoundError();
      if (note.links.length === 1) throw new IntegrityLockedError({ message: NOTE_LAST_LINK_KEY });
      await this.notes.removeLink(note.id, input.target, this.clock.now());
      await this.activityLog.record(
        noteActivity(actor, note, note.links, 'UNLINK', {
          metadata: { entityType: input.target.entityType, entityId: input.target.entityId },
        }),
      );
    });

    const note = await this.notes.findById(input.noteId);
    if (!note) throw new NotFoundError();
    return this.views.detail(note);
  }
}
