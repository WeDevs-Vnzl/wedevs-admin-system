import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../shared/domain/domain-error';
import { NOTE_ALREADY_LINKED_KEY, sameLink, type NoteLinkTarget } from '../../domain/note-link';
import type { NoteLinkTargetRegistry } from '../note-link-target.registry';
import type { NoteRepository } from '../ports/note.repository.port';
import { noteActivity, type NoteDetail, type NoteViews } from './note-support';

export interface LinkNoteInput {
  readonly noteId: string;
  readonly target: NoteLinkTarget;
}

/**
 * `POST /notes/{id}/links`: hangs the note from one more record. The note is locked first so concurrent
 * link changes serialize. A repeated target is `CONFLICT` (`notes.errors.alreadyLinked`) pointing at it;
 * an unknown or archived target is `NOT_FOUND`, an unregistered type `VALIDATION`.
 */
export class LinkNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly notes: NoteRepository,
    private readonly targets: NoteLinkTargetRegistry,
    private readonly activityLog: ActivityLogPort,
    private readonly views: NoteViews,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: LinkNoteInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'update', 'note');

    await this.uow.run(async () => {
      const note = await this.notes.findByIdForUpdate(input.noteId);
      if (!note || note.deletedAt) throw new NotFoundError();
      const [ref] = await this.targets.requireLive([input.target], () => 'entityType');
      if (note.links.some((link) => sameLink(link, input.target))) {
        throw new ConflictError({
          message: NOTE_ALREADY_LINKED_KEY,
          ...(ref ? { entity: ref } : {}),
        });
      }
      await this.notes.addLink(note.id, input.target, this.clock.now());
      await this.activityLog.record(
        noteActivity(actor, note, [...note.links, input.target], 'LINK', {
          metadata: { entityType: input.target.entityType, entityId: input.target.entityId },
        }),
      );
    });

    const note = await this.notes.findById(input.noteId);
    if (!note) throw new NotFoundError();
    return this.views.detail(note);
  }
}
