import type { DocumentFormat } from '../../../../shared/domain/enums';

export const PORTAL_READ = Symbol('PORTAL_READ');

/** The version a visitor gets of a shared document: the pinned one, or the current one. */
export interface PortalServedVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly format: DocumentFormat;
  readonly createdAt: Date;
}

/**
 * One document of a link as the portal needs it. No author, no key hash, no `File` column: a visitor learns
 * the document id, its code and title, its type id (the use case resolves the name) and the served version.
 */
export interface PortalDocumentRow {
  readonly documentId: string;
  readonly order: number;
  /** The document has an access key in this link. The hash itself never leaves the share-link adapter. */
  readonly requiresKey: boolean;
  readonly code: string;
  readonly title: string;
  readonly typeId: string;
  readonly version: PortalServedVersion;
}

/**
 * The read side of the portal (C22): only what a link serves. Reads never take a lock.
 */
export interface PortalReadPort {
  /**
   * Live (not archived, not `ANULADO`: DT-151) documents of the link in display order, each with the version a visitor gets (a
   * pinned version must belong to its document). A document with nothing to serve is left out, as is one
   * that is archived since the link was made.
   */
  documentsOf(shareLinkId: string): Promise<PortalDocumentRow[]>;
}
