import "server-only";
import { idSchema } from "@/lib/validators/common";
import { documentIdInputSchema, listDocumentVersionsInputSchema } from "@/lib/validators/documents";
import {
  shareAccessLogFilterSchema,
  shareFilterSchema,
  shareIdInputSchema,
  type ShareAccessLogFilterInput,
  type ShareFilterInput,
} from "@/lib/validators/shares";
import * as documents from "@/mocks/services/documents";
import * as shares from "@/mocks/services/shares";
import { can } from "@/server/auth/permissions";
import { getServiceContext, type ServiceContext } from "@/server/context";
import { ServiceError } from "@/server/errors";
import type { ShareableDocument } from "./types";

/** `/documents/shares` and the Compartir tab of a document (`documentId`). Owner and Admin only (`share`). */
export async function listShareLinks(filter: ShareFilterInput = {}) {
  return shares.listShareLinks(await getServiceContext(), shareFilterSchema.parse(filter));
}

/** One link; pages call `notFound()` when it throws `NOT_FOUND`. */
export async function getShareLink(id: string) {
  return shares.getShareLink(await getServiceContext(), shareIdInputSchema.parse({ id }));
}

/** The access table of one link. */
export async function listShareAccessLog(filter: ShareAccessLogFilterInput) {
  return shares.listShareAccessLog(
    await getServiceContext(),
    shareAccessLogFilterSchema.parse(filter),
  );
}

/**
 * What the signed-in role may do with share links. `share` is Owner/Admin CRUD (PRD §4.3); moving shared documents to
 * `ENVIADO` needs `document` update. Hiding a control is cosmetic; the actions check the same grants again (C13).
 */
export async function getSharePermissions() {
  const { user } = await getServiceContext();
  return {
    canRead: can(user, "read", "share"),
    canCreate: can(user, "create", "share"),
    canUpdate: can(user, "update", "share"),
    canUpdateDocuments: can(user, "update", "document"),
  };
}

/**
 * Documents as the share form lists them: status and every version, for the version pin. Unknown, malformed or
 * archived ids are left out; the order of `ids` is kept.
 */
export async function getShareableDocuments(ids: readonly string[]): Promise<ShareableDocument[]> {
  const ctx = await getServiceContext();
  const out: ShareableDocument[] = [];
  for (const id of ids) {
    if (!idSchema.safeParse(id).success) continue;
    try {
      const doc = await shareableDocumentOf(ctx, id);
      if (doc) out.push(doc);
    } catch (error) {
      if (error instanceof ServiceError) continue;
      throw error;
    }
  }
  return out;
}

/**
 * One document as the share form lists it: status and every version (newest first), for the version pin. Throws what
 * the documents service throws (`NOT_FOUND` for unknown ids); an archived document is `NOT_FOUND` too.
 */
export async function shareableDocumentOf(
  ctx: ServiceContext,
  id: string,
): Promise<ShareableDocument | null> {
  const doc = await documents.getDocument(ctx, documentIdInputSchema.parse({ id }));
  if (doc.archivedAt) return null;
  const versions = await documents.listDocumentVersions(
    ctx,
    listDocumentVersionsInputSchema.parse({ documentId: id }),
  );
  return {
    id: doc.id,
    code: doc.code,
    title: doc.title,
    status: doc.status,
    currentVersionId: doc.currentVersion?.id ?? null,
    versions: versions
      .map((version) => ({ id: version.id, versionNumber: version.versionNumber }))
      .sort((a, b) => b.versionNumber - a.versionNumber),
  };
}
