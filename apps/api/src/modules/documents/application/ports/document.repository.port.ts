import type { DateOnly } from '../../../../shared/domain/business-date';
import type { DocumentFormat, DocumentStatus, FileStatus } from '../../../../shared/domain/enums';
import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');

/** Records a document can be linked to (PRD §8.9.2). `DOCUMENT` itself is never a target (choice 5). */
export const DOCUMENT_LINK_ENTITY_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
] as const;
export type DocumentLinkEntityType = (typeof DOCUMENT_LINK_ENTITY_TYPE_VALUES)[number];

export interface DocumentLinkTarget {
  readonly entityType: DocumentLinkEntityType;
  readonly entityId: string;
}

export function isDocumentLinkEntityType(value: string): value is DocumentLinkEntityType {
  return (DOCUMENT_LINK_ENTITY_TYPE_VALUES as readonly string[]).includes(value);
}

/** Sort fields of `GET /documents` (the FE `DOCUMENT_SORT_FIELDS`). */
export const DOCUMENT_SORT_FIELDS = [
  'code',
  'title',
  'category',
  'type',
  'status',
  'format',
  'versionNumber',
  'expiresAt',
  'updatedAt',
  'createdAt',
] as const;
export type DocumentSortField = (typeof DOCUMENT_SORT_FIELDS)[number];

/** A `Document` row. Dates of the business calendar are date-only strings, instants are `Date`. */
export interface DocumentRecord {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly typeId: string;
  readonly summary: string | null;
  readonly status: DocumentStatus;
  readonly draftContent: string | null;
  readonly draftUpdatedAt: Date | null;
  readonly currentVersionId: string | null;
  readonly effectiveDate: DateOnly | null;
  readonly signedAt: DateOnly | null;
  readonly expiresAt: DateOnly | null;
  readonly alertDaysBefore: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdById: string | null;
  readonly deletedAt: Date | null;
}

export type NewDocument = Omit<DocumentRecord, 'deletedAt' | 'updatedAt'>;

/** The metadata the edit form owns. */
export interface DocumentMetaPatch {
  readonly title: string;
  readonly typeId: string;
  readonly summary: string | null;
  readonly effectiveDate: DateOnly | null;
  readonly signedAt: DateOnly | null;
  readonly expiresAt: DateOnly | null;
  readonly alertDaysBefore: number;
  readonly updatedAt: Date;
  readonly updatedById: string | null;
}

export interface DocumentLinkRecord {
  readonly id: string;
  readonly target: DocumentLinkTarget;
  readonly createdAt: Date;
}

export interface NewDocumentVersion {
  readonly id: string;
  readonly documentId: string;
  readonly format: DocumentFormat;
  readonly content: string | null;
  readonly fileId: string | null;
  readonly url: string | null;
  readonly changelog: string | null;
  readonly createdAt: Date;
  readonly createdById: string;
}

export interface UserRef {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

/** The seven `File` columns the detail may show: never `storageKey` or `bucket` (DT-140). */
export interface DocumentFileMeta {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: FileStatus;
  readonly uploadedById: string;
  readonly createdAt: Date;
}

/** The version a document currently shows, with its content. */
export interface CurrentVersionView {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly format: DocumentFormat;
  readonly content: string | null;
  readonly file: DocumentFileMeta | null;
  readonly url: string | null;
  readonly changelog: string | null;
  readonly createdBy: UserRef;
  readonly createdAt: Date;
}

/** What a view needs of a document besides its own row. */
export interface DocumentRelations {
  readonly currentVersion: CurrentVersionView | null;
  readonly versionCount: number;
  readonly links: readonly DocumentLinkRecord[];
  /** The document sits in at least one share link that is neither revoked nor expired (own table). */
  readonly isShared: boolean;
  readonly createdBy: UserRef | null;
}

/** Filters of the list and of the category counts, already validated and normalised by the use case. */
export interface DocumentListCriteria {
  readonly query: ListQuery;
  readonly statuses: readonly DocumentStatus[];
  readonly categoryIds: readonly string[];
  readonly typeIds: readonly string[];
  readonly formats: readonly DocumentFormat[];
  readonly clientIds: readonly string[];
  readonly contactIds: readonly string[];
  readonly projectIds: readonly string[];
  readonly invoiceIds: readonly string[];
  readonly paymentIds: readonly string[];
  readonly expenseIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly expiresFrom: DateOnly | null;
  readonly expiresTo: DateOnly | null;
  /** Expiring between both days (inclusive), not `VENCIDO` or `ANULADO`. */
  readonly expiring: { readonly from: DateOnly; readonly to: DateOnly } | null;
  /** `BORRADOR` untouched since before this instant. */
  readonly staleBefore: Date | null;
  readonly shared: boolean | null;
  /** The Caracas business day, for the derived share status. */
  readonly today: DateOnly;
}

/**
 * `Document` persistence for the records slice. Every write is valid only inside a unit of work; the use
 * case locks the row first (`RowLocksPort`, class `Document`). By-id reads return archived rows too and the
 * use cases decide (C14, C19).
 */
export interface DocumentRepository {
  insert(document: NewDocument): Promise<void>;
  findById(id: string): Promise<DocumentRecord | null>;
  list(criteria: DocumentListCriteria): Promise<Paginated<DocumentRecord>>;
  /**
   * Documents per category id for the category chips: the same criteria as `list` (archive scope, facets and
   * search) except `categoryIds`, and counted over the whole result, never one page window.
   */
  countByCategory(criteria: DocumentListCriteria): Promise<Record<string, number>>;
  relationsOf(ids: readonly string[], today: DateOnly): Promise<Map<string, DocumentRelations>>;
  /** `code`, `title` and whether it is archived, for note targets and tag labels. Unknown ids are absent. */
  labels(
    ids: readonly string[],
  ): Promise<Map<string, { code: string; title: string; archived: boolean }>>;

  updateMeta(id: string, patch: DocumentMetaPatch): Promise<void>;
  setStatus(
    id: string,
    change: {
      readonly status: DocumentStatus;
      readonly signedAt: DateOnly | null;
      readonly updatedAt: Date;
      readonly updatedById: string | null;
    },
  ): Promise<void>;
  archive(ids: readonly string[], at: Date, byUserId: string): Promise<void>;
  restore(id: string, at: Date, byUserId: string): Promise<void>;

  links(documentId: string): Promise<DocumentLinkRecord[]>;
  /** `false` when the document already had that link (nothing was written). */
  addLink(
    documentId: string,
    target: DocumentLinkTarget,
    link: { readonly id: string; readonly createdAt: Date; readonly createdById: string },
  ): Promise<boolean>;
  /** Hard delete of the link row (`DocumentLink` has no `deletedAt`). `false` when there was none. */
  removeLink(documentId: string, target: DocumentLinkTarget): Promise<boolean>;

  /** Whether some version already holds the file (DT-136: an upload of such a file is refused). */
  isFileHeldByVersion(fileId: string): Promise<boolean>;
  /**
   * Inserts version `max + 1` of the document, makes it current and stamps the document's `updatedAt`.
   * The caller holds the document row lock, so the number cannot be taken twice.
   */
  appendVersion(version: NewDocumentVersion): Promise<{ readonly versionNumber: number }>;
  /** The markdown of the current version, for the search body. `null` when it is not a markdown one. */
  currentMarkdown(documentId: string): Promise<string | null>;

  /** Ids of live documents the expiry step may mark: not `ANULADO`/`VENCIDO`, `expiresAt` before `today`. */
  expiredIds(today: DateOnly): Promise<string[]>;
}
