import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { NoteRepository } from '../application/ports/note.repository.port';
import { noteLabel } from '../domain/note';
import { clientScopeOf } from '../domain/note-link';

/** Lets settings' tag endpoints tag a note: `update` on `note` governs it, an archived note is not taggable. */
export class NoteTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'NOTE' as const;
  readonly resource = 'note' as const;

  constructor(private readonly notes: NoteRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const note = await this.notes.findById(id);
    if (!note || note.deletedAt) return null;
    return {
      label: noteLabel(note.title, note.content, note.id),
      clientId: clientScopeOf(note.links).clientId,
    };
  }
}
