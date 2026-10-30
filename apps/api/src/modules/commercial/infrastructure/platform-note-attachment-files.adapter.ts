import type { CurrentUser } from '../../../shared/application/current-user';
import type {
  NoteAttachmentFilesPort,
  ReservedNoteFile,
} from '../application/ports/note-attachment-files.port';
import type { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';

/**
 * `NoteAttachmentFilesPort` answered by platform's exported `ReserveFileForAttachment`: the `File` row
 * lock, the `READY` check and the ownership-or-claim check live there, never in this context (C23).
 */
export class PlatformNoteAttachmentFiles implements NoteAttachmentFilesPort {
  constructor(private readonly reserveFile: ReserveFileForAttachment) {}

  async reserve(actor: CurrentUser, fileId: string): Promise<ReservedNoteFile> {
    const file = await this.reserveFile.execute(actor, fileId);
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }
}
