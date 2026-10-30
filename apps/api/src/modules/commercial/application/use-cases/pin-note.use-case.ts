import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { diffFields } from '../../../../shared/domain/activity-diff';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { NoteRepository } from '../ports/note.repository.port';
import { noteActivity, type NoteDetail, type NoteViews } from './note-support';

export interface PinNoteInput {
  readonly id: string;
  readonly pinned: boolean;
}

/** `POST /notes/{id}/pin`: pinned notes show first in a record's feed. No write and no entry when unchanged. */
export class PinNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly views: NoteViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: PinNoteInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'update', 'note');

    await this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.id);
      if (!note || note.deletedAt) throw new NotFoundError();
      if (note.pinned === input.pinned) return;
      await this.notes.setPinned(note.id, input.pinned, this.clock.now());
      const changes = diffFields(
        { pinned: note.pinned },
        { pinned: input.pinned },
        { fields: ['pinned'] },
      );
      await this.activityLog.record(
        noteActivity(actor, note, note.links, 'UPDATE', changes ? { changes } : {}),
      );
    });

    const note = await this.notes.findById(input.id);
    if (!note) throw new NotFoundError();
    return this.views.detail(note);
  }
}
