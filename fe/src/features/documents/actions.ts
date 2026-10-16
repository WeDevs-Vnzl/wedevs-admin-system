"use server";

import {
  createDocumentInputSchema,
  documentFilterSchema,
  linkDocumentInputSchema,
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

/** Creates the metadata of a document and its links (ARCHIVO types only in H1-B2). */
export const createDocumentAction = defineAction({
  permission: { action: "create", resource: "document" },
  input: createDocumentInputSchema,
  revalidate: ["/documents"],
  handler: (ctx, data) => documents.createDocument(ctx, data),
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

/** Attaches an uploaded file as the next version of a document (the "Subir archivo" mode). */
export const uploadDocumentVersionAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: uploadVersionInputSchema,
  revalidate: ["/documents"],
  handler: (ctx, data) => documents.uploadVersion(ctx, data),
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
