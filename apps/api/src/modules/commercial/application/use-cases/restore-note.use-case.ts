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
import type { EntityRef } from '../../../../shared/domain/entity-ref';
import { noteLabel } from '../../domain/note';
import type { NoteRepository } from '../ports/note.repository.port';
import { noteActivity, noteSearchEntry } from './note-support';

export interface RestoreNoteInput {
  readonly id: string;
}

/**
 * Restores an archived note (`POST /notes/{id}/restore` and the trash handler). `can(restore, note)` needs
 * the trash grant (Owner, Admin). An unknown or live note is `NOT_FOUND`. Records `RESTORE` and reindexes.
 */
export class RestoreNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly search: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: RestoreNoteInput): Promise<EntityRef> {
    assertCan(this.authorization, actor, 'restore', 'note');

    return this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.id);
      if (!note || !note.deletedAt) throw new NotFoundError();

      await this.notes.restore(note.id, this.clock.now());
      await this.activityLog.record(noteActivity(actor, note, note.links, 'RESTORE'));
      await this.search.upsert(noteSearchEntry(note, false));
      return { type: 'NOTE', id: note.id, label: noteLabel(note.title, note.content, note.id) };
    });
  }
}
