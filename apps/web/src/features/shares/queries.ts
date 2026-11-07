import "server-only";
import { toActionResult, type ApiActionResult, type ApiResponseLike } from "@/lib/api/errors";
import type { ApiClient } from "@/lib/api/client";
import { getServerApi } from "@/lib/api/server";
import { idSchema } from "@/lib/validators/common";
import {
  shareAccessLogFilterSchema,
  shareFilterSchema,
  shareIdInputSchema,
  type ShareAccessLogFilterInput,
  type ShareFilterInput,
} from "@/lib/validators/shares";
import { can } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { ServiceError } from "@/lib/service-error";
import { toAccessLogQuery, toShareListQuery } from "./api-query";
import { toAccessLogPage, toShareDetail, toSharePage } from "./mappers";
import type { ShareableDocument } from "./types";

/**
 * Unwraps a read. A BE `404` throws `ServiceError("NOT_FOUND")`, `403` `FORBIDDEN` and `422` `VALIDATION`: the pages
 * show the in-shell not-found page for them (C13); anything else fails the render.
 */
function unwrap<T>(result: ApiResponseLike<T>, what: string): T {
  const mapped = toActionResult(result);
  if (mapped.ok) return mapped.data;
  const { code, message, fieldErrors } = mapped.error;
  if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION") {
    throw new ServiceError(code, { message, ...(fieldErrors ? { fieldErrors } : {}) });
  }
  throw new Error(`${what} failed with ${result.response.status}`);
}

/** `/documents/shares` and the Compartir tab of a document (`documentId`), through `GET /api/v1/share-links`. */
export async function listShareLinks(filter: ShareFilterInput = {}) {
  const api = await getServerApi();
  return toSharePage(
    unwrap(
      await api.GET("/api/v1/share-links", {
        params: { query: toShareListQuery(shareFilterSchema.parse(filter)) },
      }),
      "GET /api/v1/share-links",
    ),
  );
}

/** One link through `GET /api/v1/share-links/{id}`; pages call `notFound()` when it throws `NOT_FOUND`. */
export async function getShareLink(id: string) {
  const { id: linkId } = shareIdInputSchema.parse({ id });
  const api = await getServerApi();
  return toShareDetail(
    unwrap(
      await api.GET("/api/v1/share-links/{id}", { params: { path: { id: linkId } } }),
      `GET /api/v1/share-links/${linkId}`,
    ),
  );
}

/** The access table of one link (failed unlocks included), through `GET /api/v1/share-links/{id}/access-log`. */
export async function listShareAccessLog(filter: ShareAccessLogFilterInput) {
  const parsed = shareAccessLogFilterSchema.parse(filter);
  const api = await getServerApi();
  return toAccessLogPage(
    unwrap(
      await api.GET("/api/v1/share-links/{id}/access-log", {
        params: { path: { id: parsed.shareLinkId }, query: toAccessLogQuery(parsed) },
      }),
      `GET /api/v1/share-links/${parsed.shareLinkId}/access-log`,
    ),
  );
}

/**
 * What the signed-in role may do with share links. `share` is Owner/Admin CRUD (PRD §4.3); moving shared documents to
 * `ENVIADO` needs `document` update. Hiding a control is cosmetic; the BE checks the same grants again (C13).
 */
export async function getSharePermissions() {
  const user = await requireSessionUser();
  return {
    canRead: can(user, "read", "share"),
    canCreate: can(user, "create", "share"),
    canUpdate: can(user, "update", "share"),
    canUpdateDocuments: can(user, "update", "document"),
  };
}

/**
 * One document as the share form lists it, through `GET /api/v1/documents/{id}` and its `/versions`: status and every
 * version (newest first), for the version pin. `null` for an archived document (one call); a BE refusal is the error
 * result. The detail is read first, so an unknown id costs one call and a listed document two.
 */
export async function readShareableDocument(
  api: ApiClient,
  id: string,
): Promise<ApiActionResult<ShareableDocument | null>> {
  const detail = toActionResult(
    await api.GET("/api/v1/documents/{id}", { params: { path: { id } } }),
  );
  if (!detail.ok) return detail;
  const doc = detail.data;
  if (doc.archivedAt) return { ok: true, data: null };

  const versions = toActionResult(
    await api.GET("/api/v1/documents/{id}/versions", { params: { path: { id } } }),
  );
  if (!versions.ok) return versions;
  return {
    ok: true,
    data: {
      id: doc.id,
      code: doc.code,
      title: doc.title,
      status: doc.status,
      currentVersionId: doc.currentVersion?.id ?? null,
      versions: versions.data
        .map((version) => ({ id: version.id, versionNumber: version.versionNumber }))
        .sort((a, b) => b.versionNumber - a.versionNumber),
    },
  };
}

/**
 * Documents as the share form lists it: status and every version, for the version pin. Unknown, malformed or
 * archived ids are left out; the order of `ids` is kept. The BE is read twice per listed document (detail, versions).
 */
export async function getShareableDocuments(ids: readonly string[]): Promise<ShareableDocument[]> {
  const api = await getServerApi();
  const found = await Promise.all(
    ids.map(async (id) => {
      if (!idSchema.safeParse(id).success) return null;
      const result = await readShareableDocument(api, id);
      if (result.ok) return result.data;
      const { code } = result.error;
      if (code === "NOT_FOUND" || code === "FORBIDDEN" || code === "VALIDATION") return null;
      throw new Error(`reading document ${id} failed with ${code}`);
    }),
  );
  return found.filter((doc): doc is ShareableDocument => doc !== null);
}
