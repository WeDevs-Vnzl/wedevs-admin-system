// MOCK — public portal services of Hito 1 (PRD §8.11, §12 `shares`; DT-45; C11, C20, C22): the
// `PortalSharesService` contract (H1-B4 T9). Reachable only through `definePublicAction` and the
// `/api/s/[token]/files/[documentId]` route, which add the server-only request metadata (`ipHash`, `userAgent`,
// unlocked ids from the signed cookie) after parsing. Framework-free (C11). Replaced by
// `src/server/services/portal.service.ts` in Hito 2 (C9).
//
// Every failure about the link itself is the same bare `NOT_FOUND` (unknown, revoked or expired token; a document
// that is not part of the link). Access keys are verified in constant time against the scrypt hash
// (`share-keys.ts`); the key never reaches the access log.
import { toDateOnly, todayInCaracas } from "@/lib/dates";
import {
  ACCESS_KEY_LOCKOUT_MINUTES,
  ACCESS_KEY_MAX_FAILED_ATTEMPTS,
  SHARE_DOWNLOAD_TTL_SECONDS,
  getSharedDocumentDownloadServiceInputSchema,
  getSharedDocumentServiceInputSchema,
  recordShareAccessServiceInputSchema,
  resolveShareTokenServiceInputSchema,
  unlockSharedDocumentServiceInputSchema,
  type PortalDocumentContentDTO,
  type PortalDocumentDTO,
  type PortalSharesService,
  type ShareLinkDetailDTO,
} from "@/lib/validators/shares";
import type { ShareEvent } from "@/lib/validators/enums";
import type { z } from "@/lib/validators/zod";
import type { MockPublicServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { shareStatusOn } from "../fixtures/shares";
import { nextMockId } from "../ids";
import type { DocumentRow, DocumentVersionRow, MockStore } from "../store";
import { verifyAccessKey } from "./share-keys";

type Service = PortalSharesService<MockPublicServiceContext>;

/** The generic answer for anything about the link the visitor may not learn (C22): no reason, no details. */
function notFound(): ServiceError {
  return new ServiceError("NOT_FOUND");
}

/** Services trust no input; a malformed one is as unknown as a wrong token. */
function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

/**
 * The live link behind `token`, or `null` when it is unknown, revoked or expired (on `ctx.now`, Caracas). The
 * three cases are indistinguishable by design. This is the `resolveToken` of the portal's `definePublicAction`.
 */
export async function findLiveShareLink(
  ctx: MockPublicServiceContext,
  token: string,
): Promise<ShareLinkDetailDTO | null> {
  const link = ctx.db.shareLinks.find((row) => row.token === token);
  if (!link) return null;
  return shareStatusOn(link, todayInCaracas(ctx.now)) === "ACTIVE" ? link : null;
}

async function liveLink(ctx: MockPublicServiceContext, token: string): Promise<ShareLinkDetailDTO> {
  const link = await findLiveShareLink(ctx, token);
  if (!link) throw notFound();
  return link;
}

interface SharedDocument {
  doc: DocumentRow;
  version: DocumentVersionRow;
  keyHash: string | null;
}

/** A document of the link as served now (pinned or current version); `null` when it can no longer be served. */
function sharedDocument(
  db: MockStore,
  link: ShareLinkDetailDTO,
  documentId: string,
): SharedDocument | null {
  const shared = link.documents.find((item) => item.document.id === documentId);
  if (!shared) return null;
  const doc = db.documents.find((row) => row.id === documentId);
  if (!doc || doc.archivedAt !== null) return null;
  const versionId = shared.versionId ?? doc.currentVersionId;
  const version = versionId ? db.documentVersions.find((row) => row.id === versionId) : undefined;
  if (!version) return null;
  const key = db.shareDocumentKeys.find(
    (row) => row.shareLinkId === link.id && row.documentId === documentId,
  );
  return { doc, version, keyHash: key?.accessKeyHash ?? null };
}

function requireSharedDocument(
  db: MockStore,
  link: ShareLinkDetailDTO,
  documentId: string,
): SharedDocument {
  const shared = sharedDocument(db, link, documentId);
  if (!shared) throw notFound();
  return shared;
}

function isLocked(shared: SharedDocument, unlockedDocumentIds: readonly string[]): boolean {
  return shared.keyHash !== null && !unlockedDocumentIds.includes(shared.doc.id);
}

function toPortalDocument(
  db: MockStore,
  shared: SharedDocument,
  unlockedDocumentIds: readonly string[],
): PortalDocumentDTO {
  const type = db.documentTypes.find((row) => row.id === shared.doc.typeId);
  return {
    documentId: shared.doc.id,
    title: shared.doc.title,
    typeName: type?.name ?? "",
    typeNameEn: type?.nameEn ?? null,
    versionNumber: shared.version.versionNumber,
    versionDate: toDateOnly(new Date(shared.version.createdAt)),
    format: shared.version.format,
    locked: isLocked(shared, unlockedDocumentIds),
  };
}

function fileOf(db: MockStore, version: DocumentVersionRow) {
  return version.fileId ? db.files.find((row) => row.id === version.fileId) : undefined;
}

function previewOf(mimeType: string): "pdf" | "image" | "none" {
  if (mimeType === "application/pdf") return "pdf";
  return mimeType.startsWith("image/") ? "image" : "none";
}

function contentOf(db: MockStore, version: DocumentVersionRow): PortalDocumentContentDTO {
  if (version.format === "MARKDOWN") return { format: "MARKDOWN", markdown: version.content ?? "" };
  if (version.format === "ENLACE") {
    if (!version.url) throw notFound();
    return { format: "ENLACE", url: version.url };
  }
  const file = fileOf(db, version);
  if (!file) throw notFound();
  return {
    format: "ARCHIVO",
    fileName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    preview: previewOf(file.mimeType),
  };
}

/** Appends one access-log row (append-only, C20). Only the salted IP hash and the user agent are stored. */
function logAccess(
  ctx: MockPublicServiceContext,
  link: ShareLinkDetailDTO,
  event: ShareEvent,
  documentId: string | null,
  request: { ipHash: string; userAgent?: string | undefined },
): void {
  const db = ctx.db;
  db.shareAccessLogs.push({
    id: nextMockId(db.idCounters, "sacc", (id) => db.shareAccessLogs.some((row) => row.id === id)),
    shareLinkId: link.id,
    event,
    documentId,
    ipHash: request.ipHash,
    userAgent: request.userAgent ?? null,
    createdAt: ctx.now.toISOString(),
  });
}

/** Failed unlocks of this link, document and IP hash inside the lockout window (C22). */
function recentFailures(
  ctx: MockPublicServiceContext,
  link: ShareLinkDetailDTO,
  documentId: string,
  ipHash: string,
): number {
  const since = ctx.now.getTime() - ACCESS_KEY_LOCKOUT_MINUTES * 60_000;
  return ctx.db.shareAccessLogs.filter(
    (row) =>
      row.event === "UNLOCK_FAILED" &&
      row.shareLinkId === link.id &&
      row.documentId === documentId &&
      row.ipHash === ipHash &&
      Date.parse(row.createdAt) > since,
  ).length;
}

// ───────────────────────────── Services ─────────────────────────────

export const resolveShareToken: Service["resolveShareToken"] = async (ctx, input) => {
  const data = parse(resolveShareTokenServiceInputSchema, input);
  const link = await liveLink(ctx, data.token);
  const documents = [...link.documents]
    .sort((a, b) => a.order - b.order)
    .map((item) => sharedDocument(ctx.db, link, item.document.id))
    .filter((shared): shared is SharedDocument => shared !== null)
    .map((shared) => toPortalDocument(ctx.db, shared, data.unlockedDocumentIds));
  const client = link.client ? ctx.db.clients.find((row) => row.id === link.client?.id) : undefined;
  return {
    title: link.title,
    message: link.message,
    locale: link.locale,
    allowDownload: link.allowDownload,
    clientName: client?.tradeName ?? null,
    expiresAt: link.expiresAt,
    documents,
  };
};

export const recordShareAccess: Service["recordShareAccess"] = async (ctx, input) => {
  const data = parse(recordShareAccessServiceInputSchema, input);
  const link = await liveLink(ctx, data.token);
  if (data.documentId !== undefined) requireSharedDocument(ctx.db, link, data.documentId);
  logAccess(ctx, link, data.event, data.documentId ?? null, data);
  return { recorded: true };
};

/**
 * Checks the key of one document (DT-45). The lockout is keyed on link + document + IP hash: once
 * `ACCESS_KEY_MAX_FAILED_ATTEMPTS` failures fall inside the last `ACCESS_KEY_LOCKOUT_MINUTES`, every attempt —
 * right key included — answers `ACCESS_KEY_LOCKED` without checking the key. The failure that reaches the limit
 * already answers `ACCESS_KEY_LOCKED`, so the visitor learns about the lockout when it starts.
 */
export const unlockSharedDocument: Service["unlockSharedDocument"] = async (ctx, input) => {
  const data = parse(unlockSharedDocumentServiceInputSchema, input);
  const link = await liveLink(ctx, data.token);
  const shared = requireSharedDocument(ctx.db, link, data.documentId);
  if (shared.keyHash === null) return { documentId: data.documentId, unlocked: true };

  if (recentFailures(ctx, link, data.documentId, data.ipHash) >= ACCESS_KEY_MAX_FAILED_ATTEMPTS) {
    throw new ServiceError("ACCESS_KEY_LOCKED");
  }
  if (!(await verifyAccessKey(data.key, shared.keyHash))) {
    logAccess(ctx, link, "UNLOCK_FAILED", data.documentId, data);
    const failures = recentFailures(ctx, link, data.documentId, data.ipHash);
    throw new ServiceError(
      failures >= ACCESS_KEY_MAX_FAILED_ATTEMPTS ? "ACCESS_KEY_LOCKED" : "ACCESS_KEY_INVALID",
    );
  }
  logAccess(ctx, link, "UNLOCK", data.documentId, data);
  return { documentId: data.documentId, unlocked: true };
};

export const getSharedDocument: Service["getSharedDocument"] = async (ctx, input) => {
  const data = parse(getSharedDocumentServiceInputSchema, input);
  const link = await liveLink(ctx, data.token);
  const shared = requireSharedDocument(ctx.db, link, data.documentId);
  if (isLocked(shared, data.unlockedDocumentIds)) throw new ServiceError("FORBIDDEN");
  return {
    document: { ...toPortalDocument(ctx.db, shared, data.unlockedDocumentIds), locked: false },
    content: contentOf(ctx.db, shared.version),
  };
};

/**
 * A download of one document (PRD §8.11 "Descargas"): markdown as `.md`, a file or a link as a URL that expires in
 * `SHARE_DOWNLOAD_TTL_SECONDS`. Hito 1 has no storage, so a file URL is a `mock-storage://` placeholder the portal
 * route serves itself. Logs `DOWNLOAD`.
 */
export const getSharedDocumentDownload: Service["getSharedDocumentDownload"] = async (
  ctx,
  input,
) => {
  const data = parse(getSharedDocumentDownloadServiceInputSchema, input);
  const link = await liveLink(ctx, data.token);
  const shared = requireSharedDocument(ctx.db, link, data.documentId);
  if (!link.allowDownload || isLocked(shared, data.unlockedDocumentIds)) {
    throw new ServiceError("FORBIDDEN");
  }
  const content = contentOf(ctx.db, shared.version);
  logAccess(ctx, link, "DOWNLOAD", data.documentId, data);
  if (content.format === "MARKDOWN") {
    return {
      kind: "markdown",
      fileName: `${shared.doc.code}-v${shared.version.versionNumber}.md`,
      content: content.markdown,
    };
  }
  const expiresAt = new Date(ctx.now.getTime() + SHARE_DOWNLOAD_TTL_SECONDS * 1000).toISOString();
  if (content.format === "ENLACE") {
    return { kind: "url", url: content.url, fileName: shared.doc.title, expiresAt };
  }
  return {
    kind: "url",
    url: `mock-storage://${shared.version.fileId}?expires=${encodeURIComponent(expiresAt)}`,
    fileName: content.fileName,
    expiresAt,
  };
};
