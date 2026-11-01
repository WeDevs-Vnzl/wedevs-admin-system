import type {
  FileAccessClaim,
  FileAccessResolver,
} from '../../platform/application/ports/file-access.port';
import type { NoteRepository } from '../application/ports/note.repository.port';

/**
 * Registered in platform's `FileAccessRegistry`: a file attached to a live note is downloadable by whoever
 * may `read` notes (C23). A file of an archived note, or of no note, is not this context's claim.
 */
export class NoteFileAccessResolver implements FileAccessResolver {
  constructor(private readonly notes: NoteRepository) {}

  async resolve(fileId: string): Promise<FileAccessClaim | null> {
    return (await this.notes.isFileAttachedToLiveNote(fileId))
      ? { kind: 'resource', resource: 'note' }
      : null;
  }
}
