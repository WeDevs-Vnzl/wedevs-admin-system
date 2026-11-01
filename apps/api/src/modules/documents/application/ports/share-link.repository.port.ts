import type { DateOnly } from '../../../../shared/domain/business-date';
import type { DocumentFormat, DocumentStatus, ShareEvent } from '../../../../shared/domain/enums';
import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { ShareCounters, ShareStatus } from '../../domain';
import type { UserRef } from './document.repository.port';

export const SHARE_LINK_REPOSITORY = Symbol('SHARE_LINK_REPOSITORY');

/** Portal languages (`ShareLink.locale`). */
export const SHARE_LOCALE_VALUES = ['es', 'en'] as const;
export type ShareLocale = (typeof SHARE_LOCALE_VALUES)[number];

/** Sort fields of `GET /share-links` (the FE `SHARE_SORT_FIELDS`). */
export const SHARE_SORT_FIELDS = [
  'title',
  'status',
  'expiresAt',
  'viewCount',
  'downloadCount',
  'lastAccessedAt',
  'createdAt',
] as const;
export type ShareSortField = (typeof SHARE_SORT_FIELDS)[number];

/** Sort fields of `GET /share-links/{id}/access-log`. */
export const SHARE_ACCESS_LOG_SORT_FIELDS = ['createdAt', 'event'] as const;

/**
 * A `ShareLink` row. The stored counters (`viewCount`, `downloadCount`, `lastAccessedAt`) are written with the
 * access-log row by the portal (contract choice 4); `expiredAt` is only the expiry step's marker (DT-137).
 */
export interface ShareLinkRecord {
  readonly id: string;
  readonly token: string;
  readonly title: string;
  readonly message: string | null;
  readonly clientId: string | null;
  readonly locale: ShareLocale;
  readonly allowDownload: boolean;
  readonly expiresAt: DateOnly | null;
  readonly expiredAt: Date | null;
  readonly revokedAt: Date | null;
  readonly viewCount: number;
  readonly downloadCount: number;
  readonly lastAccessedAt: Date | null;
  readonly createdAt: Date;
  readonly createdById: string;
}

export type NewShareLink = Omit<
  ShareLinkRecord,
  'expiredAt' | 'revokedAt' | 'viewCount' | 'downloadCount' | 'lastAccessedAt'
>;

/** The fields the edit form owns. `expiredAt` is cleared when the expiry date moves (A6). */
export interface ShareLinkPatch {
  readonly title: string;
  readonly message: string | null;
  readonly clientId: string | null;
  readonly locale: ShareLocale;
  readonly allowDownload: boolean;
  readonly expiresAt: DateOnly | null;
  readonly clearExpiredAt: boolean;
}

/**
 * What a write does with the key of a document: keep the stored hash, clear it, or store a new one. The hash
 * is written here and never read back through this API (it stays inside the adapter).
 */
export type ShareKeyChange =
  | { readonly kind: 'keep' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly hash: string; readonly updatedAt: Date };

/** One document of a link, in display order. */
export interface ShareDocumentWrite {
  readonly documentId: string;
  /** `null` = always the current version. */
  readonly versionId: string | null;
  readonly order: number;
  readonly key: ShareKeyChange;
}

/** A `ShareLinkDocument` row without its hash. */
export interface ShareDocumentLink {
  readonly shareLinkId: string;
  readonly documentId: string;
  readonly versionId: string | null;
  readonly order: number;
  readonly hasAccessKey: boolean;
  readonly accessKeyUpdatedAt: Date | null;
}

/** A live-or-not document as a link needs to see it. */
export interface SharableDocument {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly currentVersionId: string | null;
  readonly archived: boolean;
}

/** A document of a link with what the owner sees of it. */
export interface ShareDocumentRead extends ShareDocumentLink {
  readonly document: SharableDocument;
  /** The version a visitor gets: the pinned one, or the current one. `null` while the document has none. */
  readonly served: {
    readonly id: string;
    readonly versionNumber: number;
    readonly format: DocumentFormat;
  } | null;
  /** Counters of this document derived from the access log. */
  readonly counters: ShareCounters;
}

/** What a view needs of a link besides its own row. */
export interface ShareLinkRelations {
  readonly documents: readonly ShareDocumentRead[];
  readonly createdBy: UserRef | null;
  readonly unlockCount: number;
  readonly failedUnlockCount: number;
}

/** Filters of the list, already validated and normalised by the use case. */
export interface ShareLinkListCriteria {
  readonly query: ListQuery;
  readonly statuses: readonly ShareStatus[];
  readonly clientIds: readonly string[];
  readonly documentId: string | null;
  readonly hasAccessKeys: boolean | null;
  readonly createdFrom: DateOnly | null;
  readonly createdTo: DateOnly | null;
  /** The Caracas business day, for the derived status. */
  readonly today: DateOnly;
}

export interface ShareAccessLogCriteria {
  readonly shareLinkId: string;
  readonly query: ListQuery;
  readonly events: readonly ShareEvent[];
  readonly documentId: string | null;
  readonly from: DateOnly | null;
  readonly to: DateOnly | null;
}

/** A row of the access table. `visitor` is a 12-character prefix of the salted IP hash: never the whole hash. */
export interface ShareAccessLogEntry {
  readonly id: string;
  readonly shareLinkId: string;
  readonly event: ShareEvent;
  readonly documentId: string | null;
  readonly documentTitle: string | null;
  readonly visitor: string;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}

/**
 * `ShareLink`, `ShareLinkDocument` and the read side of `ShareAccessLog`. Every write is valid only inside a
 * unit of work; the use case locks the link first (`RowLocksPort`, class `ShareLink`). By-id reads return
 * revoked links too and the use cases decide. Key hashes are written here and never returned.
 *
 * The portal package (4.1) resolves a token with `findByToken` and appends access-log rows through its own
 * port; the stored counters it increments are read back by this API.
 */
export interface ShareLinkRepository {
  insert(link: NewShareLink, documents: readonly ShareDocumentWrite[]): Promise<void>;
  findById(id: string): Promise<ShareLinkRecord | null>;
  /** Exact match on the token; `null` for an unknown one. */
  findByToken(token: string): Promise<ShareLinkRecord | null>;
  /** Documents of the link in display order. */
  documentsOf(shareLinkId: string): Promise<ShareDocumentLink[]>;
  /** The scrypt hash of a document's key, for the unlock check; `null` when keyless or not in the link. */
  accessKeyHashOf(shareLinkId: string, documentId: string): Promise<string | null>;

  update(id: string, patch: ShareLinkPatch): Promise<void>;
  /** Replaces the document list: drops the rows that are not in `documents`, upserts the rest. */
  replaceDocuments(shareLinkId: string, documents: readonly ShareDocumentWrite[]): Promise<void>;
  setKey(
    shareLinkId: string,
    documentId: string,
    key: { readonly hash: string; readonly updatedAt: Date } | null,
  ): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  markExpired(id: string, at: Date): Promise<void>;
  /** Ids of links with `expiresAt` before `today`, not revoked and not yet marked (DT-137). */
  expiredIds(today: DateOnly): Promise<string[]>;

  /** Live documents (archived ones flagged) by id; unknown ids are absent. */
  sharableDocuments(ids: readonly string[]): Promise<Map<string, SharableDocument>>;
  /** The document each version belongs to; unknown ids are absent. */
  versionOwners(versionIds: readonly string[]): Promise<Map<string, string>>;

  list(criteria: ShareLinkListCriteria): Promise<Paginated<ShareLinkRecord>>;
  relationsOf(ids: readonly string[]): Promise<Map<string, ShareLinkRelations>>;
  listAccessLog(criteria: ShareAccessLogCriteria): Promise<Paginated<ShareAccessLogEntry>>;
}
