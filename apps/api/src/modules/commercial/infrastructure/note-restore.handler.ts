import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import type { RestoreHandler } from '../../platform/application/ports/restore-handler.port';
import type { RestoreNote } from '../application/use-cases/restore-note.use-case';

/** Makes archived notes restorable from the trash: the trash delegates to the note's own use case. */
export class NoteRestoreHandler implements RestoreHandler {
  readonly entityType = 'NOTE' as const;
  readonly resource = 'note' as const;

  constructor(private readonly restoreNote: RestoreNote) {}

  restore(user: CurrentUser, entityId: string): Promise<EntityRef> {
    return this.restoreNote.execute(user, { id: entityId });
  }
}
