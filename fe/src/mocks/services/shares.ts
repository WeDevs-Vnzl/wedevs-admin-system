// MOCK — shares service of Hito 1 (PRD §12 `shares`, §8.11; DT-45; C11, C14, C20, C22): the back-office
// `SharesService` contract (H1-B4 T7). Links carry a CSPRNG token, documents pinned to a version or following the
// latest one, and optional per-document access keys stored only as scrypt hashes (`share-keys.ts`); a clear key
// appears only in the mutation result that created it. Counters and the last access are derived from the access log.
// The public portal services (`PortalSharesService`) live elsewhere (T9). Framework-free (C11). Replaced by
// `src/server/services/shares.service.ts` in Hito 2 (C9). Append-only activity (C20): every mutation logs.
import { diffFields } from "@/lib/activity-diff";
import { toDateOnly, todayInCaracas } from "@/lib/dates";
import {
  VALIDATION_MESSAGES,
  zodFieldErrors,
  type FieldErrors,
  type Paginated,
} from "@/lib/validators/common";
import {
  createShareLinkInputSchema,
  setShareDocumentAccessKeyInputSchema,
  shareAccessLogFilterSchema,
  shareFilterSchema,
  shareIdInputSchema,
  updateShareLinkInputSchema,
  type GeneratedAccessKeyDTO,
  type ShareAccessLogRowDTO,
  type ShareDocumentDTO,
  type ShareDocumentInput,
  type ShareLinkDetailDTO,
  type ShareLinkListRowDTO,
  type SharesService,
} from "@/lib/validators/shares";
import { can, type PermissionAction } from "@/server/auth/permissions";
import type { z } from "@/lib/validators/zod";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { shareCountersOf, shareLinkUrl, shareStatusOn } from "../fixtures/shares";
import { nextMockId } from "../ids";
import { resolveEntityRef } from "../entity-refs";
import type { MockStore, ShareAccessLogRow, ShareDocumentKeyRow } from "../store";
import { logActivity, mockTx } from "./activity";
import { listRows, type ListSpec } from "./list";
import { generateAccessKey, generateShareToken, hashAccessKey } from "./share-keys";

type Service = SharesService<MockServiceContext>;

/** Length of the visitor fingerprint shown in the access log (a prefix of the salted IP hash). */
const VISITOR_PREFIX_LENGTH = 12;

// ───────────────────────────── Guards and parsing ─────────────────────────────

/** Sharing is Owner/Admin only (PRD §4.3 "Compartir en el portal"); everyone else gets `FORBIDDEN`. */
function authorize(ctx: MockServiceContext, action: PermissionAction): void {
  if (!can(ctx.user, action, "share")) throw new ServiceError("FORBIDDEN");
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
  return parsed.data;
}

function storedLink(db: MockStore, id: string): ShareLinkDetailDTO {
  const link = db.shareLinks.find((row) => row.id === id);
  if (!link) throw new ServiceError("NOT_FOUND");
  return link;
}

/** A revoked link is final: the portal answers 404 and the owner can no longer change it. */
function assertNotRevoked(link: ShareLinkDetailDTO): void {
  if (link.revokedAt !== null) throw new ServiceError("INTEGRITY_LOCK");
}

function keyRowsOf(db: MockStore, shareLinkId: string): ShareDocumentKeyRow[] {
  return db.shareDocumentKeys.filter((row) => row.shareLinkId === shareLinkId);
}

function keyRowOf(
  db: MockStore,
  shareLinkId: string,
  documentId: string,
): ShareDocumentKeyRow | undefined {
  return db.shareDocumentKeys.find(
    (row) => row.shareLinkId === shareLinkId && row.documentId === documentId,
  );
}

// ───────────────────────────── Assembly ─────────────────────────────

/** The version a shared document serves: the pinned one, or the document's current one. */
function servedVersion(db: MockStore, documentId: string, versionId: string | null) {
  const doc = db.documents.find((row) => row.id === documentId);
  const id = versionId ?? doc?.currentVersionId ?? null;
  const version = id ? db.documentVersions.find((row) => row.id === id) : undefined;
  return { doc, version };
}

/**
 * Re-derives everything of a stored link that comes from other rows — document refs, statuses and served
 * versions, key flags, counters, client and author refs, status on `ctx.now`, URL — and writes it back, so the
 * stored row never goes stale (other mock services read `status` and `documents`). Keys and hashes stay in
 * `shareDocumentKeys` and never reach this DTO.
 */
function refresh(ctx: MockServiceContext, link: ShareLinkDetailDTO): ShareLinkDetailDTO {
  const db = ctx.db;
  const logs = db.shareAccessLogs.filter((row) => row.shareLinkId === link.id);
  const documents = link.documents.map((shared, order): ShareDocumentDTO => {
    const documentId = shared.document.id;
    const { doc, version } = servedVersion(db, documentId, shared.versionId);
    const key = keyRowOf(db, link.id, documentId);
    return {
      document: resolveEntityRef(db, "DOCUMENT", documentId) ?? shared.document,
      documentStatus: doc?.status ?? shared.documentStatus,
      versionId: shared.versionId,
      isLatest: version !== undefined && version.id === doc?.currentVersionId,
      versionNumber: version?.versionNumber ?? null,
      format: version?.format ?? null,
      order,
      requiresAccessKey: Boolean(key?.accessKeyHash),
      accessKeyUpdatedAt: key?.accessKeyHash ? key.accessKeyUpdatedAt : null,
      counters: shareCountersOf(logs.filter((row) => row.documentId === documentId)).counters,
    };
  });
  const author = db.users.find((user) => user.id === link.createdBy.id);
  const { counters, lastAccessedAt } = shareCountersOf(logs);
  Object.assign(link, {
    url: shareLinkUrl(link.token),
    client: link.client ? (resolveEntityRef(db, "CLIENT", link.client.id) ?? link.client) : null,
    status: shareStatusOn(link, todayInCaracas(ctx.now)),
    counters,
    lastAccessedAt,
    documents,
    createdBy: author
      ? { id: author.id, name: author.name, imageUrl: author.imageUrl }
      : link.createdBy,
  } satisfies Partial<ShareLinkDetailDTO>);
  return structuredClone(link);
}

function toListRow(detail: ShareLinkDetailDTO): ShareLinkListRowDTO {
  return {
    id: detail.id,
    title: detail.title,
    client: detail.client,
    documentCount: detail.documents.length,
    protectedDocumentCount: detail.documents.filter((doc) => doc.requiresAccessKey).length,
    status: detail.status,
    expiresAt: detail.expiresAt,
    counters: detail.counters,
    lastAccessedAt: detail.lastAccessedAt,
    createdBy: detail.createdBy,
    createdAt: detail.createdAt,
  };
}

function toAccessLogRow(db: MockStore, row: ShareAccessLogRow): ShareAccessLogRowDTO {
  const doc = row.documentId ? db.documents.find((item) => item.id === row.documentId) : undefined;
  return {
    id: row.id,
    shareLinkId: row.shareLinkId,
    event: row.event,
    documentId: row.documentId,
    documentTitle: doc?.title ?? null,
    visitor: row.ipHash.slice(0, VISITOR_PREFIX_LENGTH),
    userAgent: row.userAgent,
    createdAt: row.createdAt,
  };
}

// ───────────────────────────── Write helpers ─────────────────────────────

interface LinkFields {
  title: string;
  message?: string | undefined;
  clientId?: string | undefined;
  documents: ShareDocumentInput[];
  allowDownload: boolean;
  locale: ShareLinkDetailDTO["locale"];
  expiresAt?: string | undefined;
}

/**
 * Cross-record checks of a create or edit, all before anything is written: the client exists, every document is
 * live and has a version to serve, a pinned version belongs to its document, and the expiry is not in the past
 * (`keepExpiry` lets an edit resubmit the link's current, already passed, date unchanged).
 */
function checkReferences(ctx: MockServiceContext, data: LinkFields, keepExpiry?: string | null) {
  const db = ctx.db;
  const fieldErrors: FieldErrors = {};
  const fail = (path: string, message: string) => (fieldErrors[path] = [message]);
  if (data.clientId && !db.clients.some((row) => row.id === data.clientId && !row.archivedAt)) {
    fail("clientId", VALIDATION_MESSAGES.invalidOption);
  }
  data.documents.forEach((item, index) => {
    const doc = db.documents.find((row) => row.id === item.documentId);
    if (!doc || doc.archivedAt !== null) {
      fail(`documents.${index}.documentId`, VALIDATION_MESSAGES.invalidOption);
      return;
    }
    if (item.versionId !== null) {
      const version = db.documentVersions.find((row) => row.id === item.versionId);
      if (!version || version.documentId !== doc.id) {
        fail(`documents.${index}.versionId`, VALIDATION_MESSAGES.invalidOption);
      }
    } else if (doc.currentVersionId === null) {
      // A draft without a published version has nothing to show in the portal.
      fail(`documents.${index}.documentId`, VALIDATION_MESSAGES.invalidOption);
    }
  });
  const today = todayInCaracas(ctx.now);
  if (data.expiresAt && data.expiresAt < today && data.expiresAt !== keepExpiry) {
    fail("expiresAt", VALIDATION_MESSAGES.invalidDate);
  }
  if (Object.keys(fieldErrors).length > 0) throw new ServiceError("VALIDATION", { fieldErrors });
}

/** Shell of a document entry; `refresh` fills the derived fields. */
function documentEntry(db: MockStore, item: ShareDocumentInput, order: number): ShareDocumentDTO {
  const doc = db.documents.find((row) => row.id === item.documentId)!;
  return {
    document: { id: doc.id, code: doc.code, label: doc.title, type: "DOCUMENT" },
    documentStatus: doc.status,
    versionId: item.versionId,
    isLatest: false,
    versionNumber: null,
    format: null,
    order,
    requiresAccessKey: false,
    accessKeyUpdatedAt: null,
    counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
  };
}

/** A fresh key and its hash. The clear key leaves this module only inside the mutation result. */
async function newKey(): Promise<{ accessKey: string; accessKeyHash: string }> {
  const accessKey = generateAccessKey();
  return { accessKey, accessKeyHash: await hashAccessKey(accessKey) };
}

function newToken(db: MockStore): string {
  let token = generateShareToken();
  while (db.shareLinks.some((row) => row.token === token)) token = generateShareToken();
  return token;
}

function clientRef(db: MockStore, clientId: string | undefined) {
  return clientId ? resolveEntityRef(db, "CLIENT", clientId) : null;
}

// ───────────────────────────── Mutations ─────────────────────────────

export const createShareLink: Service["createShareLink"] = async (ctx, input) => {
  authorize(ctx, "create");
  const data = parse(createShareLinkInputSchema, input);
  checkReferences(ctx, data);
  const db = ctx.db;

  // Hash every key before writing anything, so a failure leaves no half-created link.
  const keyed = data.documents.filter((item) => item.requiresAccessKey);
  const keys = await Promise.all(keyed.map(() => newKey()));

  const nowIso = ctx.now.toISOString();
  const id = nextMockId(db.idCounters, "shr", (taken) =>
    db.shareLinks.some((row) => row.id === taken),
  );
  const token = newToken(db);
  const link: ShareLinkDetailDTO = {
    id,
    token,
    url: shareLinkUrl(token),
    title: data.title,
    message: data.message ?? null,
    client: clientRef(db, data.clientId),
    locale: data.locale,
    allowDownload: data.allowDownload,
    expiresAt: data.expiresAt ?? null,
    revokedAt: null,
    status: "ACTIVE",
    counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
    lastAccessedAt: null,
    documents: data.documents.map((item, order) => documentEntry(db, item, order)),
    createdBy: { id: ctx.user.id, name: ctx.user.name, imageUrl: ctx.user.imageUrl },
    createdAt: nowIso,
  };
  db.shareLinks.push(link);

  const generatedKeys: GeneratedAccessKeyDTO[] = [];
  for (const item of data.documents) {
    const index = keyed.indexOf(item);
    const key = index >= 0 ? keys[index] : undefined;
    db.shareDocumentKeys.push({
      shareLinkId: id,
      documentId: item.documentId,
      accessKeyHash: key?.accessKeyHash ?? null,
      accessKeyUpdatedAt: key ? nowIso : null,
    });
    if (key) generatedKeys.push({ documentId: item.documentId, accessKey: key.accessKey });
  }

  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "SHARE_CREATE",
    entityType: "SHARE_LINK",
    entityId: id,
    entityLabel: link.title,
    metadata: { documentCount: data.documents.length, protectedDocumentCount: keyed.length },
  });
  return { share: refresh(ctx, link), generatedKeys };
};

/** Fields of the edit form compared for the activity diff (the message is long text: "changed" only). */
const DIFF_FIELDS = ["title", "message", "clientId", "allowDownload", "locale", "expiresAt"];

export const updateShareLink: Service["updateShareLink"] = async (ctx, input) => {
  authorize(ctx, "update");
  const data = parse(updateShareLinkInputSchema, input);
  const db = ctx.db;
  const link = storedLink(db, data.id);
  assertNotRevoked(link);
  checkReferences(ctx, data, link.expiresAt);

  // Plan the key changes and hash the new keys before writing anything.
  const previousKeys = keyRowsOf(db, link.id);
  const toGenerate = data.documents.filter(
    (item) =>
      item.requiresAccessKey &&
      !previousKeys.some((row) => row.documentId === item.documentId && row.accessKeyHash),
  );
  const keys = await Promise.all(toGenerate.map(() => newKey()));
  const nowIso = ctx.now.toISOString();

  const nextKeys: ShareDocumentKeyRow[] = [];
  const generatedKeys: GeneratedAccessKeyDTO[] = [];
  let keysChanged = false;
  for (const item of data.documents) {
    const previous = previousKeys.find((row) => row.documentId === item.documentId);
    const index = toGenerate.indexOf(item);
    const key = index >= 0 ? keys[index] : undefined;
    if (key) {
      nextKeys.push({
        shareLinkId: link.id,
        documentId: item.documentId,
        accessKeyHash: key.accessKeyHash,
        accessKeyUpdatedAt: nowIso,
      });
      generatedKeys.push({ documentId: item.documentId, accessKey: key.accessKey });
      keysChanged = true;
    } else if (item.requiresAccessKey && previous) {
      nextKeys.push(previous); // keeps its key
    } else {
      if (previous?.accessKeyHash) keysChanged = true; // key removed
      nextKeys.push({
        shareLinkId: link.id,
        documentId: item.documentId,
        accessKeyHash: null,
        accessKeyUpdatedAt: null,
      });
    }
  }
  // A document dropped from the link takes its key with it.
  for (const row of previousKeys) {
    if (row.accessKeyHash && !data.documents.some((item) => item.documentId === row.documentId)) {
      keysChanged = true;
    }
  }

  const before = {
    title: link.title,
    message: link.message,
    clientId: link.client?.id ?? null,
    allowDownload: link.allowDownload,
    locale: link.locale,
    expiresAt: link.expiresAt,
  };
  const documentsBefore = JSON.stringify(link.documents.map((d) => [d.document.id, d.versionId]));
  const documentsAfter = JSON.stringify(data.documents.map((d) => [d.documentId, d.versionId]));

  db.shareDocumentKeys = [
    ...db.shareDocumentKeys.filter((row) => row.shareLinkId !== link.id),
    ...nextKeys,
  ];
  Object.assign(link, {
    title: data.title,
    message: data.message ?? null,
    client: clientRef(db, data.clientId),
    locale: data.locale,
    allowDownload: data.allowDownload,
    expiresAt: data.expiresAt ?? null,
    documents: data.documents.map((item, order) => documentEntry(db, item, order)),
  } satisfies Partial<ShareLinkDetailDTO>);

  const after = { ...data, message: data.message ?? null, clientId: data.clientId ?? null };
  const changes = {
    ...diffFields(
      before,
      { ...after, expiresAt: data.expiresAt ?? null },
      {
        fields: DIFF_FIELDS,
        longText: ["message"],
      },
    ),
    ...(documentsBefore !== documentsAfter ? { documents: "changed" as const } : {}),
    ...(keysChanged ? { accessKey: "changed" as const } : {}),
  };
  if (Object.keys(changes).length > 0) {
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "UPDATE",
      entityType: "SHARE_LINK",
      entityId: link.id,
      entityLabel: link.title,
      changes,
    });
  }
  return { share: refresh(ctx, link), generatedKeys };
};

export const revokeShareLink: Service["revokeShareLink"] = async (ctx, input) => {
  authorize(ctx, "update");
  const data = parse(shareIdInputSchema, input);
  const link = storedLink(ctx.db, data.id);
  assertNotRevoked(link);
  link.revokedAt = ctx.now.toISOString();
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "SHARE_REVOKE",
    entityType: "SHARE_LINK",
    entityId: link.id,
    entityLabel: link.title,
  });
  return refresh(ctx, link);
};

/**
 * `generate` needs a document without a key, `regenerate` and `remove` one with a key; any other combination is a
 * `CONFLICT` (a stale UI), so a key is never replaced or shown by accident. The clear key is returned once.
 */
export const setShareDocumentAccessKey: Service["setShareDocumentAccessKey"] = async (
  ctx,
  input,
) => {
  authorize(ctx, "update");
  const data = parse(setShareDocumentAccessKeyInputSchema, input);
  const db = ctx.db;
  const link = storedLink(db, data.shareLinkId);
  const row = keyRowOf(db, link.id, data.documentId);
  if (!row || !link.documents.some((doc) => doc.document.id === data.documentId)) {
    throw new ServiceError("NOT_FOUND");
  }
  assertNotRevoked(link);
  const hasKey = row.accessKeyHash !== null;
  if ((data.action === "generate") === hasKey) throw new ServiceError("CONFLICT");

  let accessKey: string | null = null;
  if (data.action === "remove") {
    row.accessKeyHash = null;
    row.accessKeyUpdatedAt = null;
  } else {
    const key = await newKey();
    accessKey = key.accessKey;
    row.accessKeyHash = key.accessKeyHash;
    row.accessKeyUpdatedAt = ctx.now.toISOString();
  }

  // Data-rules Δ2: the key is recorded only as "changed", never its value.
  await logActivity(mockTx(ctx), {
    actorType: "USER",
    actorId: ctx.user.id,
    action: "UPDATE",
    entityType: "SHARE_LINK",
    entityId: link.id,
    entityLabel: link.title,
    changes: { accessKey: "changed" },
    metadata: { documentId: data.documentId, accessKeyAction: data.action },
  });
  refresh(ctx, link);
  return {
    shareLinkId: link.id,
    documentId: data.documentId,
    action: data.action,
    requiresAccessKey: row.accessKeyHash !== null,
    accessKeyUpdatedAt: row.accessKeyUpdatedAt,
    accessKey,
  };
};

// ───────────────────────────── Reads ─────────────────────────────

const linkSpec: ListSpec<ShareLinkDetailDTO> = {
  searchText: (row) => [row.title, row.client?.label, row.client?.code],
  sorters: {
    title: (row) => row.title,
    status: (row) => row.status,
    expiresAt: (row) => row.expiresAt,
    viewCount: (row) => row.counters.viewCount,
    downloadCount: (row) => row.counters.downloadCount,
    lastAccessedAt: (row) => row.lastAccessedAt,
    createdAt: (row) => row.createdAt,
  },
  defaultSort: "createdAt:desc",
};

const facetPasses = (asked: readonly string[] | undefined, actual: string | null | undefined) =>
  asked === undefined || (actual != null && asked.includes(actual));

/**
 * `/documents/shares` and a document's "Compartir" tab. Facets: `status`, `clientId`, `documentId` (links that
 * include it), `hasAccessKeys`, and `createdFrom` / `createdTo` (Caracas days of `createdAt`, inclusive).
 */
export const listShareLinks: Service["listShareLinks"] = async (ctx, input) => {
  authorize(ctx, "read");
  const filter = parse(shareFilterSchema, input);
  const rows = ctx.db.shareLinks
    .map((link) => refresh(ctx, link))
    .filter((row) => facetPasses(filter.status, row.status))
    .filter((row) => facetPasses(filter.clientId, row.client?.id))
    .filter(
      (row) =>
        filter.documentId === undefined ||
        row.documents.some((doc) => doc.document.id === filter.documentId),
    )
    .filter(
      (row) =>
        filter.hasAccessKeys === undefined ||
        row.documents.some((doc) => doc.requiresAccessKey) === filter.hasAccessKeys,
    )
    .filter((row) => {
      const day = toDateOnly(new Date(row.createdAt));
      return (
        (!filter.createdFrom || day >= filter.createdFrom) &&
        (!filter.createdTo || day <= filter.createdTo)
      );
    });
  const page: Paginated<ShareLinkDetailDTO> = listRows(rows, filter, linkSpec);
  return { ...page, items: page.items.map(toListRow) };
};

export const getShareLink: Service["getShareLink"] = async (ctx, input) => {
  authorize(ctx, "read");
  const data = parse(shareIdInputSchema, input);
  return refresh(ctx, storedLink(ctx.db, data.id));
};

const accessLogSpec: ListSpec<ShareAccessLogRowDTO> = {
  searchText: (row) => [row.documentTitle, row.userAgent],
  sorters: { createdAt: (row) => row.createdAt, event: (row) => row.event },
  defaultSort: "createdAt:desc",
};

/** Access table of one link, newest first; `from` / `to` are Caracas days of `createdAt` (inclusive). */
export const listShareAccessLog: Service["listShareAccessLog"] = async (ctx, input) => {
  authorize(ctx, "read");
  const filter = parse(shareAccessLogFilterSchema, input);
  const db = ctx.db;
  storedLink(db, filter.shareLinkId);
  const rows = db.shareAccessLogs
    .filter((row) => row.shareLinkId === filter.shareLinkId)
    .filter((row) => facetPasses(filter.event, row.event))
    .filter((row) => filter.documentId === undefined || row.documentId === filter.documentId)
    .filter((row) => {
      const day = toDateOnly(new Date(row.createdAt));
      return (!filter.from || day >= filter.from) && (!filter.to || day <= filter.to);
    })
    .map((row) => toAccessLogRow(db, row));
  return listRows(rows, filter, accessLogSpec);
};
