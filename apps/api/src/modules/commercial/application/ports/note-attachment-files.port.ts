import type { CurrentUser } from '../../../../shared/application/current-user';

export const NOTE_ATTACHMENT_FILES = Symbol('NOTE_ATTACHMENT_FILES');

export interface ReservedNoteFile {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Claims a file for a note (C23). Valid only inside the note's unit of work: it takes the file row lock
 * that a concurrent delete also takes. Throws `NOT_FOUND` for a file that is unknown, not `READY`, or
 * neither the caller's own upload nor already claimed by a resource the caller can read (C14).
 */
export interface NoteAttachmentFilesPort {
  reserve(actor: CurrentUser, fileId: string): Promise<ReservedNoteFile>;
}
