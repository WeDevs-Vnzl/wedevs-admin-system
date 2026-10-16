"use server";

import {
  createDocumentWithVersionInputSchema,
  documentFilterSchema,
  linkDocumentInputSchema,
  publishVersionInputSchema,
  restoreVersionInputSchema,
  saveDraftInputSchema,
  setDocumentStatusInputSchema,
  unlinkDocumentInputSchema,
  updateDocumentMetaInputSchema,
  uploadVersionInputSchema,
} from "@/lib/validators/documents";
import { listQuerySchema, type EntityRef } from "@/lib/validators/common";
import * as documents from "@/mocks/services/documents";
import { defineAction } from "@/server/actions/define-action";

/** At most this many options in the attach sheet's document combobox. */
const SEARCH_LIMIT = 20;

// Minimal documents actions of H1-B2 (H1-B4 extends them). Writes go through `can()` grants of the PRD §4.3
// matrix: `document` is CRU for Owner, Admin and Member, READ for Viewer. The type rules of the document are
// enforced by the service (`createDocumentInputSchemaFor`), once the type is known.

/**
 * Creates a document with its links and, when `initialVersion` is given, its first version in the same atomic call:
 * a file that is not `READY` or a bad URL leaves nothing behind.
 */
export const createDocumentAction = defineAction({
  permission: { action: "create", resource: "document" },
  input: createDocumentWithVersionInputSchema,
  revalidate: ["/documents"],
  handler: (ctx, { initialVersion, ...data }) =>
    documents.createDocument(ctx, data, initialVersion),
});

/**
 * Updates the metadata of a document (`/documents/[id]/edit`). The type rules of the chosen type
 * (`updateDocumentMetaInputSchemaFor`) are enforced by the service once the type is known.
 */
export const updateDocumentMetaAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: updateDocumentMetaInputSchema,
  revalidate: ["/documents"],
  handler: (ctx, data) => documents.updateDocumentMeta(ctx, data),
});

/** One page of `/documents/list` for the table's query (facets, search, sort, pagination). Every role reads. */
export const listDocumentsAction = defineAction({
  permission: { action: "read", resource: "document" },
  input: documentFilterSchema,
  handler: (ctx, data) => documents.listDocuments(ctx, data),
});

/** Links an existing document to a client or a project (the "Vincular existente" mode). */
export const linkDocumentAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: linkDocumentInputSchema,
  revalidate: ["/documents"],
  handler: (ctx, data) => documents.linkDocument(ctx, data),
});

/** Removes one link; the document and its other links stay (HU-20 CA2). */
export const unlinkDocumentAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: unlinkDocumentInputSchema,
  revalidate: ["/documents"],
  handler: (ctx, data) => documents.unlinkDocument(ctx, data),
});

/**
 * Read behind the link picker's `AsyncCombobox`: at most 20 `EntityRef` options (archived documents excluded) for the
 * trimmed `q`. Every role reads documents (`document` READ), so the search needs no write grant.
 */
export const searchDocumentsAction = defineAction({
  permission: { action: "read", resource: "document" },
  input: listQuerySchema.pick({ q: true }),
  handler: async (ctx, data): Promise<EntityRef[]> => {
    const page = await documents.listDocuments(ctx, documentFilterSchema.parse({ q: data.q }));
    return page.items.slice(0, SEARCH_LIMIT).map((row) => ({
      id: row.id,
      code: row.code,
      label: row.title,
      type: "DOCUMENT" as const,
    }));
  },
});

// Writes of the document detail (`/documents/[id]`): status (S6) and versions (S5). Every action checks `can()`
// (`document` UPDATE: Owner, Admin, Member) and parses its input with zod before the service runs (C13); the type
// rules (`FIRMADO` only on types with signature), the transition table and the signature lock (`INTEGRITY_LOCK`) are
// the service's.

/** The overview, the table and this document's detail and version pages show what changed. */
function detailPaths(documentId: string) {
  return [
    "/documents",
    "/documents/list",
    { path: `/documents/${documentId}`, type: "layout" as const },
  ];
}

/** "Cambiar estado": an allowed transition; `FIRMADO` carries its signature date. */
export const setDocumentStatusAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: setDocumentStatusInputSchema,
  revalidate: (data) => detailPaths(data.id),
  handler: (ctx, data) => documents.setDocumentStatus(ctx, data),
});

/** "Restaurar": a new current version N+1 copying the chosen one; the history is never rewritten. */
export const restoreDocumentVersionAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: restoreVersionInputSchema,
  revalidate: (data) => detailPaths(data.documentId),
  handler: (ctx, data) => documents.restoreVersion(ctx, data),
});

/** "Subir nueva versión" (a `READY` file) or "Actualizar enlace" (an `http(s)` URL). */
export const uploadNewDocumentVersionAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: uploadVersionInputSchema,
  revalidate: (data) => detailPaths(data.documentId),
  handler: (ctx, data) => documents.uploadVersion(ctx, data),
});

// Server actions of the markdown editor (`/documents/[id]/editor`, PRD §8.9.3). Both write the document, so they
// need the `document` UPDATE grant (Owner, Admin, Member). The service locks a `FIRMADO` document (INTEGRITY_LOCK).

/**
 * "Save draft": stores the editor's text as the document's draft (`draftContent`) and logs the change. It creates
 * no version. The editor never saves on its own; this runs only when the user saves.
 */
export const saveDocumentDraftAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: saveDraftInputSchema,
  handler: (ctx, data) => documents.saveDraft(ctx, data),
});

/**
 * "Publicar versión": freezes `content` (the editor's latest text, saved or not) as the
 * immutable version N+1 with the optional change note, and makes it current.
 */
export const publishDocumentVersionAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: publishVersionInputSchema,
  revalidate: (data) => ["/documents", `/documents/${data.documentId}`],
  handler: (ctx, data) => documents.publishVersion(ctx, data),
});
