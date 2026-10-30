import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { NoteRepository } from '../ports/note.repository.port';
import type { NoteDetail, NoteViews } from './note-support';

export interface GetNoteInput {
  readonly id: string;
}

/**
 * `GET /notes/{id}`. An archived note is readable by id only for the trash roles (C19); for anyone else
 * it does not exist.
 */
export class GetNote {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly notes: NoteRepository,
    private readonly views: NoteViews,
  ) {}

  async execute(actor: CurrentUser, input: GetNoteInput): Promise<NoteDetail> {
    assertCan(this.authorization, actor, 'read', 'note');
    const note = await this.notes.findById(input.id);
    if (!note) throw new NotFoundError();
    if (note.deletedAt && !this.authorization.can(actor, 'restore', 'trash')) {
      throw new NotFoundError();
    }
    return this.views.detail(note);
  }
}
