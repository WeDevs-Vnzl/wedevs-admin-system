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
import type { NoteRepository } from '../ports/note.repository.port';
import { noteActivity } from './note-support';

export interface ArchiveNoteInput {
  readonly id: string;
}

export interface ArchivedNoteOutput {
  readonly id: string;
  readonly archivedAt: Date;
}

/**
 * `POST /notes/{id}/archive` (soft delete, C19). Owner and Admin archive any note; a Member only their
 * own (C13): the grant is `can(delete, note, { ownerId: authorId })`, checked once the note is loaded.
 * Records `DELETE` and archives the search entry.
 */
export class ArchiveNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly search: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: ArchiveNoteInput): Promise<ArchivedNoteOutput> {
    // Coarse gate: whoever may not even read notes learns nothing about them.
    assertCan(this.authorization, actor, 'read', 'note');

    return this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.id);
      if (!note || note.deletedAt) throw new NotFoundError();
      assertCan(this.authorization, actor, 'delete', 'note', { ownerId: note.author.id });

      const archivedAt = this.clock.now();
      await this.notes.archive(note.id, archivedAt, actor.userId);
      await this.activityLog.record(noteActivity(actor, note, note.links, 'DELETE'));
      await this.search.setArchived('NOTE', note.id, true);
      return { id: note.id, archivedAt };
    });
  }
}
