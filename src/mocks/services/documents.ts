// MOCK — minimal documents service of Hito 1 (PRD §12 `documents`, §8.9; C8, C9, C11, C14, C19, C20). H1-B2 keeps
// only what the cross-entity "Documentos" tab and its attach sheet need: list by linked client or project, create
// (ARCHIVO only), upload the first file as a version, link and unlink. H1-B4 takes ownership of this file and
// extends it, keeping the exported names. Framework-free (C11). Replaced by `src/server/services/documents.service.ts`
// in Hito 2 (C9). Append-only activity (C20): every mutation logs through `logActivity`.
import {
  createDocumentInputSchemaFor,
  type CreateDocumentInput,
  type DocumentDetailDTO,
  type DocumentFilter,
  type DocumentLinkDTO,
  type DocumentListRowDTO,
  type DocumentVersionDetailDTO,
  type LinkDocumentInput,
  type UnlinkDocumentInput,
  type UploadVersionInput,
} from "@/lib/validators/documents";
import type { DocumentTypeRefDTO } from "@/lib/validators/document-types";
import { VALIDATION_MESSAGES, zodFieldErrors, type Paginated } from "@/lib/validators/common";
import type { UserRefDTO } from "@/lib/validators/users";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockCode, nextMockId } from "../ids";
import { resolveEntityRef } from "../entity-refs";
import type { DocumentLinkRow, DocumentRow, DocumentVersionRow, MockStore } from "../store";
import { deriveMockStore } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";

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

function toDetail(db: MockStore, doc: DocumentRow): DocumentDetailDTO {
  const type = db.documentTypes.find((item) => item.id === doc.typeId);
  const category = type ? categoryRef(db, type.categoryId) : null;
  if (!type || !category) throw new ServiceError("NOT_FOUND");
  const version = currentVersion(db, doc);
  const currentVersionDto: DocumentVersionDetailDTO | null = version
    ? {
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
        isCurrent: true,
        content: version.content,
      }
    : null;
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
 * Documents of the store, filtered and paginated. Archived documents are always left out (the minimal list of
 * H1-B2). `clientId` / `projectId` keep the documents linked to those records; `categoryId` / `typeId` /
 * `format` / `status` / `tagId` / `expiresFrom` / `expiresTo` follow the filter schema. `q` matches code and title.
 * Facets not listed here (`shared`, `expiringWithinDays`, `staleDraft`) are accepted but not applied until H1-B4.
 */
export async function listDocuments(
  ctx: MockServiceContext,
  input: DocumentFilter,
): Promise<Paginated<DocumentListRowDTO>> {
  const db = ctx.db;
  const candidates = db.documents
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
    .map((doc) => toListCandidate(db, doc))
    .filter((candidate): candidate is ListCandidate => candidate !== null)
    .filter((candidate) => facetPasses(input.categoryId, candidate.row.category.id))
    .filter((candidate) => facetPasses(input.format, candidate.format));
  const page = listRows(candidates, input, candidateSpec);
  return { ...page, items: page.items.map((candidate) => candidate.row) };
}

// ───────────────────────────── Writes ─────────────────────────────

/**
 * Creates a `BORRADOR` document with the next `DOC-####` code and its links. The type rules are the ones of
 * `createDocumentInputSchemaFor(type)`. Only types whose default format is `ARCHIVO` are accepted here (H1-B4 adds
 * the other two). The file travels separately: `uploadVersion` attaches it as version 1.
 */
export async function createDocument(
  ctx: MockServiceContext,
  input: CreateDocumentInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const type = db.documentTypes.find((row) => row.id === input.typeId);
  if (!type || !type.active) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { typeId: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
  if (type.defaultFormat !== "ARCHIVO") {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { typeId: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
  const parsed = createDocumentInputSchemaFor({
    requiresSignature: type.requiresSignature,
    hasExpiration: type.hasExpiration,
  }).safeParse(input);
  if (!parsed.success)
    throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
  const data = parsed.data;

  for (const target of data.links) {
    if (!resolveEntityRef(db, target.entityType, target.entityId))
      throw new ServiceError("NOT_FOUND");
  }

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
    });
  }
  deriveMockStore(db);
  return toDetail(db, row);
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

/**
 * Attaches an uploaded file as the next version of an `ARCHIVO` document (the "Subir archivo" mode of the
 * attach sheet). The file must be `READY` (C14: unknown ids are a plain `NOT_FOUND`). A `FIRMADO` document accepts
 * no new version (INTEGRITY_LOCK, C19). `ENLACE` versions are H1-B4.
 */
export async function uploadVersion(
  ctx: MockServiceContext,
  input: UploadVersionInput,
): Promise<DocumentDetailDTO> {
  const db = ctx.db;
  const doc = activeDocument(db, input.documentId);
  if (input.format !== "ARCHIVO") {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { url: [VALIDATION_MESSAGES.invalidOption] },
    });
  }
  if (doc.status === "FIRMADO") throw new ServiceError("INTEGRITY_LOCK");
  const file = db.files.find((row) => row.id === input.fileId);
  if (!file || file.status !== "READY") throw new ServiceError("NOT_FOUND");

  const previous = db.documentVersions.filter((version) => version.documentId === doc.id);
  const nowIso = ctx.now.toISOString();
  const version: DocumentVersionRow = {
    id: nextMockId(db.idCounters, "dver", (taken) =>
      db.documentVersions.some((row) => row.id === taken),
    ),
    documentId: doc.id,
    versionNumber: previous.length + 1,
    format: "ARCHIVO",
    fileId: file.id,
    url: null,
    changelog: input.changelog ?? null,
    createdById: ctx.user.id,
    createdAt: nowIso,
    content: null,
  };
  db.documentVersions.push(version);
  doc.currentVersionId = version.id;
  doc.updatedAt = nowIso;

  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "UPLOAD",
    entityType: "DOCUMENT",
    entityId: doc.id,
    entityLabel: doc.title,
  });
  deriveMockStore(db);
  return toDetail(db, doc);
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
  if (!resolveEntityRef(db, target.entityType, target.entityId))
    throw new ServiceError("NOT_FOUND");
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
    });
    deriveMockStore(db);
  }
  return linksOf(db, doc.id);
}
