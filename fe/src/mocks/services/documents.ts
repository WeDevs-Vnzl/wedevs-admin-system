// MOCK — documents service of Hito 1 (PRD §12 `documents`, §8.9; C8, C9, C11, C14, C19, C20): the whole
// `DocumentsService` contract. H1-B2 wrote the list, create, upload, link and unlink pieces for the cross-entity
// "Documentos" tab; H1-B4 adds metadata edits, the markdown draft and versions (S5), statuses (S6), archive, the
// reads and the overview (S7), keeping the exported names. Framework-free (C11). Replaced by
// `src/server/services/documents.service.ts` in Hito 2 (C9). Append-only activity (C20): every mutation logs through
// `logActivity`, except the draft autosave, which is not a change of the document (it runs every 5 s and creates no
// version; publishing it is logged).
import { diffFields } from "@/lib/activity-diff";
import { addDays, todayInCaracas } from "@/lib/dates";
import {
  canTransitionDocument,
  createDocumentInputSchemaFor,
  documentTypeRuleIssues,
  getDocumentsOverviewInputSchema,
  setDocumentStatusInputSchemaFor,
  updateDocumentMetaInputSchemaFor,
  type ArchiveDocumentInput,
  type ArchiveDocumentsInput,
  type CreateDocumentInput,
  type DocumentDetailDTO,
  type DocumentFilter,
  type DocumentIdInput,
  type DocumentLinkDTO,
  type DocumentListRowDTO,
  type DocumentsOverviewDTO,
  type DocumentVersionDetailDTO,
  type DocumentVersionRowDTO,
  type GetDocumentVersionInput,
  type GetDocumentsOverviewInput,
  type LinkDocumentInput,
  type ListDocumentVersionsInput,
  type PublishVersionInput,
  type RestoreVersionInput,
  type SaveDraftInput,
  type SaveDraftResultDTO,
  type SetDocumentStatusInput,
  type UnlinkDocumentInput,
  type UpdateDocumentMetaInput,
  type UploadVersionInput,
} from "@/lib/validators/documents";
import type { DocumentTypeRefDTO } from "@/lib/validators/document-types";
import type { DocumentStatus } from "@/lib/validators/enums";
import { httpUrlSchema } from "@/lib/validators/tags";
import type { ArchivedRecordDTO } from "@/lib/validators/trash";
import { VALIDATION_MESSAGES, zodFieldErrors, type Paginated } from "@/lib/validators/common";
import { can } from "@/server/auth/permissions";
import type { UserRefDTO } from "@/lib/validators/users";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockCode, nextMockId } from "../ids";
import { resolveEntityRef } from "../entity-refs";
import type { DocumentLinkRow, DocumentRow, DocumentVersionRow, MockStore } from "../store";
import { deriveMockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { foldText, listRows, type ListSpec } from "./list";

// ───────────────────────────── Assembly ─────────────────────────────

function userRef(db: MockStore, id: string | null): UserRefDTO | null {
  if (!id) return null;
  const user = db.users.find((row) => row.id === id);
  return user ? { id: user.id, name: user.name, imageUrl: user.imageUrl } : null;
}

function typeRef(row: MockStore["documentTypes"][number]): DocumentTypeRefDTO {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    defaultFormat: row.defaultFormat,
    requiresSignature: row.requiresSignature,
    hasExpiration: row.hasExpiration,
  };
}

function categoryRef(db: MockStore, categoryId: string) {
  const category = db.documentCategories.find((row) => row.id === categoryId);
  return category
    ? { id: category.id, name: category.name, nameEn: category.nameEn, color: category.color }
    : null;
}

function linkRows(db: MockStore, documentId: string): DocumentLinkRow[] {
  return db.documentLinks.filter((link) => link.documentId === documentId);
}

/** Resolved links; a target that no longer resolves is left out rather than shown blank. */
function linksOf(db: MockStore, documentId: string): DocumentLinkDTO[] {
  return linkRows(db, documentId).flatMap((link) => {
    const entity = resolveEntityRef(db, link.entityType, link.entityId);
    return entity ? [{ id: link.id, entity, createdAt: link.createdAt }] : [];
  });
}

function currentVersion(db: MockStore, doc: DocumentRow): DocumentVersionRow | undefined {
  return db.documentVersions.find((version) => version.id === doc.currentVersionId);
}

function isShared(db: MockStore, documentId: string): boolean {
  return db.shareLinks.some(
    (link) =>
      link.status === "ACTIVE" &&
      link.documents.some((shared) => shared.document.id === documentId),
  );
}

function tagChips(db: MockStore, tagIds: readonly string[]) {
  return db.tags
    .filter((tag) => tagIds.includes(tag.id))
    .map(({ id, name, color }) => ({ id, name, color }));
}

/** Row of the table, with the sort keys that `DocumentRow` alone carries (`createdAt`, `versionNumber`). */
interface ListCandidate {
  row: DocumentListRowDTO;
  createdAt: string;
  format: string | null;
}

function toListCandidate(db: MockStore, doc: DocumentRow): ListCandidate | null {
  const type = db.documentTypes.find((item) => item.id === doc.typeId);
  const category = type ? categoryRef(db, type.categoryId) : null;
  if (!type || !category) return null;
  const version = currentVersion(db, doc);
  return {
    createdAt: doc.createdAt,
    format: version?.format ?? null,
    row: {
      id: doc.id,
      code: doc.code,
      title: doc.title,
      category,
      type: typeRef(type),
      status: doc.status,
      currentFormat: version?.format ?? null,
      currentVersionNumber: version?.versionNumber ?? null,
      links: linksOf(db, doc.id).map((link) => link.entity),
      expiresAt: doc.expiresAt,
      isShared: isShared(db, doc.id),
      tags: tagChips(db, doc.tagIds),
      updatedAt: doc.updatedAt,
      archivedAt: doc.archivedAt,
    },
  };
}

/** History row of a version: no content (PRD §8.9.3 "Historial"). */
function toVersionRow(db: MockStore, version: DocumentVersionRow): DocumentVersionRowDTO {
  const doc = db.documents.find((row) => row.id === version.documentId);
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    format: version.format,
    file: version.fileId ? (db.files.find((file) => file.id === version.fileId) ?? null) : null,
    url: version.url,
    changelog: version.changelog,
    createdBy: userRef(db, version.createdById) ?? {
      id: version.createdById,
      name: "",
      imageUrl: null,
    },
    createdAt: version.createdAt,
    isCurrent: doc?.currentVersionId === version.id,
  };
}

function toVersionDetail(db: MockStore, version: DocumentVersionRow): DocumentVersionDetailDTO {
  return { ...toVersionRow(db, version), content: version.content };
}

function toDetail(db: MockStore, doc: DocumentRow): DocumentDetailDTO {
  const type = db.documentTypes.find((item) => item.id === doc.typeId);
  const category = type ? categoryRef(db, type.categoryId) : null;
  if (!type || !category) throw new ServiceError("NOT_FOUND");
  const version = currentVersion(db, doc);
  const currentVersionDto = version ? toVersionDetail(db, version) : null;
  return {
    id: doc.id,
    code: doc.code,
    title: doc.title,
    type: typeRef(type),
    category,
    summary: doc.summary,
    status: doc.status,
    effectiveDate: doc.effectiveDate,
    signedAt: doc.signedAt,
    expiresAt: doc.expiresAt,
    alertDaysBefore: doc.alertDaysBefore,
    currentVersion: currentVersionDto,
    versionCount: db.documentVersions.filter((item) => item.documentId === doc.id).length,
    draftContent: doc.draftContent,
    draftUpdatedAt: doc.draftUpdatedAt,
    links: linksOf(db, doc.id),
    tags: tagChips(db, doc.tagIds),
    isShared: isShared(db, doc.id),
    createdBy: userRef(db, doc.createdById),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    archivedAt: doc.archivedAt,
  };
}

// ───────────────────────────── Reads ─────────────────────────────

/** Days without changes after which a `BORRADOR` counts as a stale draft (PRD §8.9.5 "Overview"). */
const STALE_DRAFT_DAYS = 14;

/** Statuses that never count as "por vencer": already expired or voided. */
const NOT_EXPIRING: readonly DocumentStatus[] = ["VENCIDO", "ANULADO"];

/** A facet passes when no value was asked for, or the actual value is one of those asked for. */
function facetPasses(
  asked: readonly string[] | undefined,
  actual: string | null | undefined,
): boolean {
  return asked === undefined || (actual != null && asked.includes(actual));
}

/** A linked-entity facet (`clientId` / `projectId`) passes when the document links one of the asked records. */
function linkedTo(
  db: MockStore,
  documentId: string,
  entityType: "CLIENT" | "PROJECT",
  asked: readonly string[] | undefined,
): boolean {
  if (asked === undefined) return true;
  return linkRows(db, documentId).some(
    (link) => link.entityType === entityType && asked.includes(link.entityId),
  );
}

/** Expires between today and today + `days` (both inclusive), and is not already expired or voided. */
function expiresWithin(doc: DocumentRow, today: string, days: number): boolean {
  return (
    doc.expiresAt !== null &&
    !NOT_EXPIRING.includes(doc.status) &&
    doc.expiresAt >= today &&
    doc.expiresAt <= addDays(today, days)
  );
}

/** A `BORRADOR` untouched for more than 14 days. */
function isStaleDraft(doc: DocumentRow, now: Date): boolean {
  const limit = new Date(now.getTime() - STALE_DRAFT_DAYS * 86_400_000).toISOString();
  return doc.status === "BORRADOR" && doc.updatedAt < limit;
}

const candidateSpec: ListSpec<ListCandidate> = {
  searchText: (candidate) => [candidate.row.code, candidate.row.title],
  sorters: {
    code: (c) => c.row.code,
    title: (c) => c.row.title,
    category: (c) => c.row.category.name,
    type: (c) => c.row.type.name,
    status: (c) => c.row.status,
    format: (c) => c.format,
    versionNumber: (c) => c.row.currentVersionNumber,
    expiresAt: (c) => c.row.expiresAt,
    updatedAt: (c) => c.row.updatedAt,
    createdAt: (c) => c.createdAt,
  },
  defaultSort: "updatedAt:desc",
};

/**
 * Every live document that passes `input`, before `q` and pagination; `categoryId` is skipped when
 * `ignoreCategory` (the category chips count every category under the other facets).
 */
function filteredCandidates(
  ctx: MockServiceContext,
  input: DocumentFilter,
  ignoreCategory = false,
): ListCandidate[] {
  const db = ctx.db;
  const today = todayInCaracas(ctx.now);
  return db.documents
    .filter((doc) => doc.archivedAt === null)
    .filter((doc) => linkedTo(db, doc.id, "CLIENT", input.clientId))
    .filter((doc) => linkedTo(db, doc.id, "PROJECT", input.projectId))
    .filter((doc) => facetPasses(input.status, doc.status))
    .filter((doc) => facetPasses(input.typeId, doc.typeId))
    .filter(
      (doc) => input.tagId === undefined || doc.tagIds.some((id) => input.tagId?.includes(id)),
    )
    .filter(
      (doc) => !input.expiresFrom || (doc.expiresAt !== null && doc.expiresAt >= input.expiresFrom),
    )
    .filter(
      (doc) => !input.expiresTo || (doc.expiresAt !== null && doc.expiresAt <= input.expiresTo),
    )
    .filter(
      (doc) =>
        input.expiringWithinDays === undefined ||
        expiresWithin(doc, today, input.expiringWithinDays),
    )
    .filter((doc) => !input.staleDraft || isStaleDraft(doc, ctx.now))
    .filter((doc) => input.shared === undefined || isShared(db, doc.id) === input.shared)
    .map((doc) => toListCandidate(db, doc))
    .filter((candidate): candidate is ListCandidate => candidate !== null)
    .filter(
      (candidate) => ignoreCategory || facetPasses(input.categoryId, candidate.row.category.id),
    )
    .filter((candidate) => facetPasses(input.format, candidate.format));
}

/**
 * Documents of the store, filtered over the whole set and then paginated. Archived documents are always left out.
 * `clientId` / `projectId` keep the documents linked to those records; the other facets follow the filter schema:
 * `expiringWithinDays` (today to today + N, not `VENCIDO` / `ANULADO`), `staleDraft` (`BORRADOR` untouched for more
 * than 14 days) and `shared` (in an active portal link). `q` matches code and title.
 */
export async function listDocuments(
  ctx: MockServiceContext,
  input: DocumentFilter,
): Promise<Paginated<DocumentListRowDTO>> {
  const page = listRows(filteredCandidates(ctx, input), input, candidateSpec);
  return { ...page, items: page.items.map((candidate) => candidate.row) };
}

/**
 * Category chip counts (S11 3005): live documents per category id under every facet of `input` except `categoryId`
 * and the page window, so the chips count the whole set rather than one page. `q` applies. Categories with no
 * document are absent (count 0).
 */
export async function countDocumentsByCategory(
  ctx: MockServiceContext,
  input: DocumentFilter,
): Promise<Record<string, number>> {
  const needle = input.q ? foldText(input.q) : null;
  const counts: Record<string, number> = {};
  for (const candidate of filteredCandidates(ctx, input, true)) {
    const texts = candidateSpec.searchText(candidate);
    if (needle && !texts.some((text) => text != null && foldText(text).includes(needle))) continue;
    const id = candidate.row.category.id;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** Whether the caller may read archived documents (the trash grant, C19). */
function seesArchived(ctx: MockServiceContext): boolean {
  return can(ctx.user, "restore", "trash");
}

/** A document the caller may read: archived ones only for roles that may open the trash (C14). */
function readableDocument(ctx: MockServiceContext, id: string): DocumentRow {
  const doc = ctx.db.documents.find((row) => row.id === id);
  if (!doc || (doc.archivedAt !== null && !seesArchived(ctx))) throw new ServiceError("NOT_FOUND");
  return doc;
}

export async function getDocument(
  ctx: MockServiceContext,
  input: DocumentIdInput,
): Promise<DocumentDetailDTO> {
  return toDetail(ctx.db, readableDocument(ctx, input.id));
}

/** Version history, newest first, without content (PRD §8.9.3 "Historial"). */
export async function listDocumentVersions(
  ctx: MockServiceContext,
  input: ListDocumentVersionsInput,
): Promise<DocumentVersionRowDTO[]> {
  const doc = readableDocument(ctx, input.documentId);
  return ctx.db.documentVersions
    .filter((version) => version.documentId === doc.id)
    .sort((a, b) => b.versionNumber - a.versionNumber)
    .map((version) => toVersionRow(ctx.db, version));
}

/** One version with its markdown content (viewer and diff). A version of another document is `NOT_FOUND`. */
export async function getDocumentVersion(
  ctx: MockServiceContext,
  input: GetDocumentVersionInput,
): Promise<DocumentVersionDetailDTO> {
  const doc = readableDocument(ctx, input.documentId);
  return toVersionDetail(ctx.db, versionOf(ctx.db, doc, input.versionId));
}

function versionOf(db: MockStore, doc: DocumentRow, versionId: string): DocumentVersionRow {
  const version = db.documentVersions.find(
    (row) => row.id === versionId && row.documentId === doc.id,
  );
  if (!version) throw new ServiceError("NOT_FOUND");
  return version;
}

/** Rows shown in each overview list. */
const OVERVIEW_RECENT = 5;
const OVERVIEW_EXPIRING = 10;

/**
 * `/documents` overview (PRD §8.9.5): live documents per category (in the categories' order) and status, the
 * cumulative 30/60/90-day expiry counts, the documents expiring within 90 days (soonest first), the most recently
 * updated ones and the drafts untouched for more than 14 days (oldest first). The input is empty (strict).
 */
export async function getDocumentsOverview(
  ctx: MockServiceContext,
  input: GetDocumentsOverviewInput = {},
): Promise<DocumentsOverviewDTO> {
  getDocumentsOverviewInputSchema.parse(input);
  const db = ctx.db;
  const today = todayInCaracas(ctx.now);
  const live = db.documents.filter((doc) => doc.archivedAt === null);
  const rowOf = (doc: DocumentRow) => toListCandidate(db, doc)?.row ?? null;
  const rows = (docs: DocumentRow[]) =>
    docs.map(rowOf).filter((row): row is DocumentListRowDTO => row !== null);

  const byCategoryAndStatus = [...db.documentCategories]
    .sort((a, b) => a.order - b.order)
    .map((category) => {
      const countByStatus: Partial<Record<DocumentStatus, number>> = {};
      for (const row of rows(live)) {
        if (row.category.id === category.id) {
          countByStatus[row.status] = (countByStatus[row.status] ?? 0) + 1;
        }
      }
      return { category: categoryRef(db, category.id)!, countByStatus };
    });

  const expiring = (days: number) => live.filter((doc) => expiresWithin(doc, today, days));
  const byUpdated = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    byCategoryAndStatus,
    expiringCounts: {
      days30: expiring(30).length,
      days60: expiring(60).length,
      days90: expiring(90).length,
    },
    expiringSoon: rows(
      expiring(90)
        .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!))
        .slice(0, OVERVIEW_EXPIRING),
    ),
    recent: rows(byUpdated.slice(0, OVERVIEW_RECENT)),
    staleDrafts: rows(byUpdated.filter((doc) => isStaleDraft(doc, ctx.now)).reverse()),
  };
}

// ───────────────────────────── Writes ─────────────────────────────

/** First version handed to `createDocument` with the metadata: a `READY` file or an `http(s)` URL. */
export type InitialDocumentVersion =
  | { format: "ARCHIVO"; fileId: string; changelog?: string | undefined }
  | { format: "ENLACE"; url: string; changelog?: string | undefined };

/** Content of a version about to be appended, already checked. */
type VersionContent = Pick<DocumentVersionRow, "format" | "fileId" | "url" | "content">;

/** Checks a file or link version before anything is written: `READY` file (C14 `NOT_FOUND`), `http(s)` URL. */
function checkedVersionContent(db: MockStore, input: InitialDocumentVersion): VersionContent {
  if (input.format === "ARCHIVO") {
    const file = db.files.find((row) => row.id === input.fileId);
    if (!file || file.status !== "READY") throw new ServiceError("NOT_FOUND");
    return { format: "ARCHIVO", fileId: file.id, url: null, content: null };
  }
  const url = httpUrlSchema.safeParse(input.url);
  if (!url.success) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { url: [VALIDATION_MESSAGES.invalidFormat] },
    });
  }
  return { format: "ENLACE", fileId: null, url: url.data, content: null };
}

/** A `FIRMADO` document accepts no new version nor draft (PRD §8.9.3 "Bloqueo por firma", C19). */
function assertNotSigned(doc: DocumentRow): void {
  if (doc.status === "FIRMADO") throw new ServiceError("INTEGRITY_LOCK");
}

/**
 * Appends version N+1 (immutable) to `doc`, makes it current and logs it: `UPLOAD` for a file, `VERSION_PUBLISH`
 * otherwise, with the version number (and the restored one) in the metadata.
 */
async function appendVersion(
  ctx: MockServiceContext,
  doc: DocumentRow,
  content: VersionContent,
  changelog: string | null,
  restoredFrom?: number,
): Promise<DocumentVersionRow> {
  const db = ctx.db;
  const nowIso = ctx.now.toISOString();
  const last = Math.max(
    0,
    ...db.documentVersions
      .filter((row) => row.documentId === doc.id)
      .map((row) => row.versionNumber),
  );
  const version: DocumentVersionRow = {
    id: nextMockId(db.idCounters, "dver", (taken) =>
      db.documentVersions.some((row) => row.id === taken),
    ),
    documentId: doc.id,
    versionNumber: last + 1,
    ...content,
    changelog,
    createdById: ctx.user.id,
    createdAt: nowIso,
  };
  db.documentVersions.push(version);
  doc.currentVersionId = version.id;
  doc.updatedAt = nowIso;
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action:
      content.format === "ARCHIVO" && restoredFrom === undefined ? "UPLOAD" : "VERSION_PUBLISH",
    entityType: "DOCUMENT",
    entityId: doc.id,
    entityLabel: doc.title,
    metadata: {
      versionNumber: version.versionNumber,
      format: version.format,
      ...(restoredFrom === undefined ? {} : { restoredFrom }),
    },
  });
  return version;
}

/** The type of a document being created or retyped: it must exist and be active, else `VALIDATION` on `typeId`. */
function activeType(db: MockStore, typeId: string) {
  const type = db.documentTypes.find((row) => row.id === typeId);
  if (!type || !type.active) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { typeId: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
  return type;
}

/**
 * Creates a `BORRADOR` document with the next `DOC-####` code and its links, for any format. The type rules are the
 * ones of `createDocumentInputSchemaFor(type)`. With `initialVersion` (a `READY` file or a link) the document gets
 * it as version 1 in the same call, atomically (S11 3005): the file, the URL, the type and the link targets are all
 * checked before anything is written, so a failure leaves no version-less `BORRADOR`, link, code or activity entry
 * behind. Without it the document starts with no version (markdown drafts; `uploadVersion` adds files later).
 */
export async function createDocument(
  ctx: MockServiceContext,
  input: CreateDocumentInput,
  initialVersion?: InitialDocumentVersion,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const type = activeType(db, input.typeId);
  const parsed = createDocumentInputSchemaFor({
    requiresSignature: type.requiresSignature,
    hasExpiration: type.hasExpiration,
  }).safeParse(input);
  if (!parsed.success)
    throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
  const data = parsed.data;

  for (const target of data.links) requireLinkable(db, target);
  const firstVersion = initialVersion ? checkedVersionContent(db, initialVersion) : null;

  const nowIso = ctx.now.toISOString();
  const id = nextMockId(db.idCounters, "doc", (taken) =>
    db.documents.some((row) => row.id === taken),
  );
  const row: DocumentRow = {
    id,
    code: nextMockCode(db.sequences, "DOC"),
    title: data.title,
    typeId: data.typeId,
    summary: data.summary ?? null,
    status: "BORRADOR",
    effectiveDate: data.effectiveDate ?? null,
    signedAt: data.signedAt ?? null,
    expiresAt: data.expiresAt ?? null,
    alertDaysBefore: data.alertDaysBefore,
    currentVersionId: null,
    draftContent: null,
    draftUpdatedAt: null,
    tagIds: data.tagIds,
    createdById: ctx.user.id,
    createdAt: nowIso,
    updatedAt: nowIso,
    archivedAt: null,
    deletedById: null,
  };
  db.documents.push(row);

  const tx = mockTx(ctx);
  await logActivity(tx, {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "CREATE",
    entityType: "DOCUMENT",
    entityId: id,
    entityLabel: row.title,
  });
  for (const target of data.links) {
    db.documentLinks.push(linkRow(ctx, id, target.entityType, target.entityId));
    await logActivity(tx, {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "LINK",
      entityType: "DOCUMENT",
      entityId: id,
      entityLabel: row.title,
      metadata: { entityType: target.entityType, entityId: target.entityId },
    });
  }
  if (firstVersion) {
    await appendVersion(ctx, row, firstVersion, initialVersion?.changelog ?? null);
  }
  deriveMockStore(db);
  return toDetail(db, row);
}

/** A record a document may link: it must exist and not be archived (C14/C19), both answer `NOT_FOUND`. */
function requireLinkable(db: MockStore, target: LinkDocumentInput["target"]): void {
  if (!resolveEntityRef(db, target.entityType, target.entityId)) {
    throw new ServiceError("NOT_FOUND");
  }
  const collections: Partial<
    Record<string, readonly { id: string; archivedAt?: string | null }[]>
  > = {
    CLIENT: db.clients,
    CONTACT: db.contacts,
    PROJECT: db.projects,
    DOCUMENT: db.documents,
    NOTE: db.notes,
  };
  const row = collections[target.entityType]?.find((item) => item.id === target.entityId);
  if (row?.archivedAt) throw new ServiceError("NOT_FOUND");
}

function linkRow(
  ctx: MockServiceContext,
  documentId: string,
  entityType: LinkDocumentInput["target"]["entityType"],
  entityId: string,
): DocumentLinkRow {
  return {
    id: nextMockId(ctx.db.idCounters, "dlk", (taken) =>
      ctx.db.documentLinks.some((link) => link.id === taken),
    ),
    documentId,
    entityType,
    entityId,
    createdAt: ctx.now.toISOString(),
  };
}

function activeDocument(db: MockStore, id: string): DocumentRow {
  const doc = db.documents.find((row) => row.id === id);
  if (!doc || doc.archivedAt !== null) throw new ServiceError("NOT_FOUND");
  return doc;
}

const DOCUMENT_DIFF_FIELDS = [
  "title",
  "typeId",
  "summary",
  "effectiveDate",
  "signedAt",
  "expiresAt",
  "alertDaysBefore",
  "tagIds",
] as const;

/**
 * Edits the metadata of a live document (status, links and content have their own services). The rules are the
 * ones of `updateDocumentMetaInputSchemaFor(type)` for the (possibly new) type, plus the document's current status:
 * a `FIRMADO` document cannot move to a type without signature (`documentTypeRuleIssues`) nor lose its signature
 * date. Logs `UPDATE` with the changed fields, only when something changed.
 */
export async function updateDocumentMeta(
  ctx: MockServiceContext,
  input: UpdateDocumentMetaInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const doc = activeDocument(db, input.id);
  const type =
    input.typeId === doc.typeId
      ? db.documentTypes.find((row) => row.id === doc.typeId)
      : activeType(db, input.typeId);
  if (!type) throw new ServiceError("NOT_FOUND");
  const caps = { requiresSignature: type.requiresSignature, hasExpiration: type.hasExpiration };
  const parsed = updateDocumentMetaInputSchemaFor(caps).safeParse(input);
  if (!parsed.success)
    throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
  const data = parsed.data;
  const statusIssue = documentTypeRuleIssues(caps, { status: doc.status }).find(
    (issue) => issue.path === "status",
  );
  if (statusIssue) {
    throw new ServiceError("VALIDATION", { fieldErrors: { status: [statusIssue.message] } });
  }
  if (doc.status === "FIRMADO" && !data.signedAt) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { signedAt: [VALIDATION_MESSAGES.required] },
    });
  }

  const before = { ...doc };
  doc.title = data.title;
  doc.typeId = data.typeId;
  doc.summary = data.summary ?? null;
  doc.effectiveDate = data.effectiveDate ?? null;
  doc.signedAt = data.signedAt ?? null;
  doc.expiresAt = data.expiresAt ?? null;
  doc.alertDaysBefore = data.alertDaysBefore;
  doc.tagIds = [...data.tagIds];
  const changes = diffFields(before, doc, {
    fields: DOCUMENT_DIFF_FIELDS,
    longText: ["summary"],
  });
  if (changes) {
    doc.updatedAt = ctx.now.toISOString();
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "DOCUMENT",
      entityId: doc.id,
      entityLabel: doc.title,
      changes,
    });
    deriveMockStore(db);
  }
  return toDetail(db, doc);
}

/**
 * Markdown autosave (PRD §8.9.3 "Borrador con autoguardado"): stores the draft and its time. It creates no version
 * and logs nothing (it runs every 5 s; publishing is the logged change). A `FIRMADO` document is locked.
 */
export async function saveDraft(
  ctx: MockServiceContext,
  input: SaveDraftInput,
): Promise<SaveDraftResultDTO> {
  const doc = activeDocument(ctx.db, input.documentId);
  assertNotSigned(doc);
  const nowIso = ctx.now.toISOString();
  doc.draftContent = input.content;
  doc.draftUpdatedAt = nowIso;
  doc.updatedAt = nowIso;
  return { documentId: doc.id, draftUpdatedAt: nowIso };
}

/**
 * "Publicar versión" (PRD §8.9.3): freezes `content` (the editor's latest text) or else the stored draft as the
 * immutable `MARKDOWN` version N+1 with the optional changelog, makes it current and clears the draft. No content
 * and no draft is `VALIDATION` on `content`; a `FIRMADO` document is `INTEGRITY_LOCK`.
 */
export async function publishVersion(
  ctx: MockServiceContext,
  input: PublishVersionInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const doc = activeDocument(db, input.documentId);
  assertNotSigned(doc);
  const content = input.content ?? doc.draftContent;
  if (!content) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { content: [VALIDATION_MESSAGES.required] },
    });
  }
  await appendVersion(
    ctx,
    doc,
    { format: "MARKDOWN", fileId: null, url: null, content },
    input.changelog ?? null,
  );
  doc.draftContent = null;
  doc.draftUpdatedAt = null;
  deriveMockStore(db);
  return toDetail(db, doc);
}

/**
 * "Subir nueva versión" (a `READY` file; C14: unknown or not ready is a plain `NOT_FOUND`) or "Actualizar enlace"
 * (an `http(s)` URL): the next version of the document, made current. A `FIRMADO` document accepts no new version
 * (INTEGRITY_LOCK, C19).
 */
export async function uploadVersion(
  ctx: MockServiceContext,
  input: UploadVersionInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const doc = activeDocument(db, input.documentId);
  assertNotSigned(doc);
  const content = checkedVersionContent(db, input);
  await appendVersion(ctx, doc, content, input.changelog ?? null);
  deriveMockStore(db);
  return toDetail(db, doc);
}

/**
 * Restores a version (PRD §8.9.3 "Historial"): a new current version N+1 copying the chosen one (format, file, URL,
 * content); the history is never rewritten. A version of another document is `NOT_FOUND`; `FIRMADO` is locked.
 */
export async function restoreVersion(
  ctx: MockServiceContext,
  input: RestoreVersionInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const doc = activeDocument(db, input.documentId);
  const chosen = versionOf(db, doc, input.versionId);
  assertNotSigned(doc);
  await appendVersion(
    ctx,
    doc,
    { format: chosen.format, fileId: chosen.fileId, url: chosen.url, content: chosen.content },
    input.changelog ?? null,
    chosen.versionNumber,
  );
  deriveMockStore(db);
  return toDetail(db, doc);
}

/**
 * Status change (PRD §8.9.4) through `canTransitionDocument` and `setDocumentStatusInputSchemaFor(type)`: `FIRMADO`
 * only on types with signature and with its signature date (stored on the document); `VENCIDO` is never set by a
 * person. A transition the table does not allow is `VALIDATION` on `status`. Logs `STATUS_CHANGE`.
 */
export async function setDocumentStatus(
  ctx: MockServiceContext,
  input: SetDocumentStatusInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const doc = activeDocument(db, input.id);
  const type = db.documentTypes.find((row) => row.id === doc.typeId);
  if (!type) throw new ServiceError("NOT_FOUND");
  const caps = { requiresSignature: type.requiresSignature, hasExpiration: type.hasExpiration };
  const parsed = setDocumentStatusInputSchemaFor(caps).safeParse(input);
  if (!parsed.success)
    throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
  const data = parsed.data;
  if (!canTransitionDocument(doc.status, data.status, caps)) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { status: [VALIDATION_MESSAGES.invalidOption] },
    });
  }

  const before = { status: doc.status, signedAt: doc.signedAt };
  doc.status = data.status;
  if (data.status === "FIRMADO") doc.signedAt = data.signedAt ?? null;
  doc.updatedAt = ctx.now.toISOString();
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "STATUS_CHANGE",
    entityType: "DOCUMENT",
    entityId: doc.id,
    entityLabel: doc.title,
    changes: diffFields(before, doc, { fields: ["status", "signedAt"] }),
  });
  deriveMockStore(db);
  return toDetail(db, doc);
}

/** Soft delete (C19): stamps `archivedAt` and `deletedById` and logs `DELETE`. */
async function archiveRow(ctx: MockServiceContext, doc: DocumentRow): Promise<ArchivedRecordDTO> {
  const archivedAt = ctx.now.toISOString();
  doc.archivedAt = archivedAt;
  doc.deletedById = ctx.user.id;
  doc.updatedAt = archivedAt;
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "DELETE",
    entityType: "DOCUMENT",
    entityId: doc.id,
    entityLabel: doc.title,
  });
  return { id: doc.id, archivedAt };
}

/** Archives a live document; an unknown or already archived one is `NOT_FOUND`. */
export async function archiveDocument(
  ctx: MockServiceContext,
  input: ArchiveDocumentInput,
): Promise<ArchivedRecordDTO> {
  const result = await archiveRow(ctx, activeDocument(ctx.db, input.id));
  deriveMockStore(ctx.db);
  return result;
}

/** Bulk archive: all or nothing, so one unknown id leaves the whole selection untouched. */
export async function archiveDocuments(
  ctx: MockServiceContext,
  input: ArchiveDocumentsInput,
): Promise<{ archived: ArchivedRecordDTO[] }> {
  const docs = [...new Set(input.ids)].map((id) => activeDocument(ctx.db, id));
  const archived: ArchivedRecordDTO[] = [];
  for (const doc of docs) archived.push(await archiveRow(ctx, doc));
  deriveMockStore(ctx.db);
  return { archived };
}

/**
 * Links one record to a document. Linking the same record twice changes nothing and returns the current links.
 * Returns every link of the document, resolved.
 */
export async function linkDocument(
  ctx: MockServiceContext,
  input: LinkDocumentInput,
): Promise<DocumentLinkDTO[]> {
  const db = ctx.db;
  const doc = activeDocument(db, input.documentId);
  const target = input.target;
  requireLinkable(db, target);
  const exists = linkRows(db, doc.id).some(
    (link) => link.entityType === target.entityType && link.entityId === target.entityId,
  );
  if (!exists) {
    db.documentLinks.push(linkRow(ctx, doc.id, target.entityType, target.entityId));
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "LINK",
      entityType: "DOCUMENT",
      entityId: doc.id,
      entityLabel: doc.title,
      metadata: { entityType: target.entityType, entityId: target.entityId },
    });
    deriveMockStore(db);
  }
  return linksOf(db, doc.id);
}

/**
 * Removes one link of a document (HU-20 CA2). The document's other links, and the document itself, are untouched.
 */
export async function unlinkDocument(
  ctx: MockServiceContext,
  input: UnlinkDocumentInput,
): Promise<DocumentLinkDTO[]> {
  const db = ctx.db;
  const doc = activeDocument(db, input.documentId);
  const target = input.target;
  const index = db.documentLinks.findIndex(
    (link) =>
      link.documentId === doc.id &&
      link.entityType === target.entityType &&
      link.entityId === target.entityId,
  );
  if (index >= 0) {
    db.documentLinks.splice(index, 1);
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UNLINK",
      entityType: "DOCUMENT",
      entityId: doc.id,
      entityLabel: doc.title,
      metadata: { entityType: target.entityType, entityId: target.entityId },
    });
    deriveMockStore(db);
  }
  return linksOf(db, doc.id);
}
