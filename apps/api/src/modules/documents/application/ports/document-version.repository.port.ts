import type { DocumentFormat } from '../../../../shared/domain/enums';
import type { DocumentFileMeta, UserRef } from './document.repository.port';

export const DOCUMENT_VERSION_REPOSITORY = Symbol('DOCUMENT_VERSION_REPOSITORY');

/** A version in the history list: no content (PRD §8.9.3 "Historial"). */
export interface DocumentVersionRow {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly format: DocumentFormat;
  /** The seven `File` columns only, never `storageKey` or `bucket` (DT-140). */
  readonly file: DocumentFileMeta | null;
  readonly url: string | null;
  readonly changelog: string | null;
  readonly createdBy: UserRef;
  readonly createdAt: Date;
  readonly isCurrent: boolean;
}

/** One version with its markdown content (`MARKDOWN` only), for the viewer, the diff and a restore. */
export interface DocumentVersionWithContent extends DocumentVersionRow {
  readonly content: string | null;
}

/**
 * Version reads and the markdown draft of a document (DT-139). Appending a version is `DocumentSupport`'s
 * job (it owns the numbering under the document row lock); every write here is valid only inside a unit of
 * work whose caller holds that lock. Reads never take a lock.
 */
export interface DocumentVersionRepository {
  /** Every version of the document, newest first. */
  list(documentId: string): Promise<DocumentVersionRow[]>;
  /** The version when it belongs to the document, else `null` (a version of another document is not found). */
  findInDocument(documentId: string, versionId: string): Promise<DocumentVersionWithContent | null>;
  /** Format of the current version, `null` while the document has none. */
  currentFormat(documentId: string): Promise<DocumentFormat | null>;

  /** Stores the explicit "Save draft" and stamps the document (DT-139). Creates no version. */
  saveDraft(
    documentId: string,
    change: { readonly content: string; readonly at: Date; readonly byUserId: string },
  ): Promise<void>;
  /** Clears the draft once it is published. */
  clearDraft(documentId: string): Promise<void>;

  /** Whether some version of a live (not archived) document holds the file (C23, A3). */
  isFileOfLiveDocument(fileId: string): Promise<boolean>;
}
