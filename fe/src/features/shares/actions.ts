"use server";

import { documentIdInputSchema } from "@/lib/validators/documents";
import {
  createShareLinkInputSchema,
  revokeShareLinkInputSchema,
  setShareDocumentAccessKeyInputSchema,
  shareAccessLogFilterSchema,
  shareFilterSchema,
  updateShareLinkInputSchema,
} from "@/lib/validators/shares";
import * as documents from "@/mocks/services/documents";
import * as shares from "@/mocks/services/shares";
import { defineAction } from "@/server/actions/define-action";
import { ServiceError } from "@/server/errors";
import { markDocumentsSentInputSchema } from "./schemas";
import { shareableDocumentOf } from "./queries";

// Share link actions (PRD §8.11, DT-45). `share` is CRUD for Owner and Admin only (PRD §4.3). Every action goes
// through `defineAction`: session → `can()` → zod → service. Results that carry a clear access key
// (`generatedKeys`, `accessKey`) are returned to the caller once and never stored or logged here.

const SHARES_PATH = "/documents/shares";

/** Creates a link from a document, a client or a project; the result carries the keys generated once. */
export const createShareLinkAction = defineAction({
  permission: { action: "create", resource: "share" },
  input: createShareLinkInputSchema,
  revalidate: [SHARES_PATH, "/documents"],
  handler: (ctx, data) => shares.createShareLink(ctx, data),
});

/** Edits title, message, locale, expiry, download and the documents (add, remove, re-pin, key on/off). */
export const updateShareLinkAction = defineAction({
  permission: { action: "update", resource: "share" },
  input: updateShareLinkInputSchema,
  revalidate: [SHARES_PATH, "/documents"],
  handler: (ctx, data) => shares.updateShareLink(ctx, data),
});

/** Revokes a link: the portal then answers the generic 404. */
export const revokeShareLinkAction = defineAction({
  permission: { action: "update", resource: "share" },
  input: revokeShareLinkInputSchema,
  revalidate: [SHARES_PATH, "/documents"],
  handler: (ctx, data) => shares.revokeShareLink(ctx, data),
});

/** Generates, regenerates or removes the access key of one document of a link; a new key is returned once. */
export const setShareDocumentAccessKeyAction = defineAction({
  permission: { action: "update", resource: "share" },
  input: setShareDocumentAccessKeyInputSchema,
  revalidate: [SHARES_PATH],
  handler: (ctx, data) => shares.setShareDocumentAccessKey(ctx, data),
});

/** One page of `/documents/shares` for the table's query. */
export const listShareLinksAction = defineAction({
  permission: { action: "read", resource: "share" },
  input: shareFilterSchema,
  handler: (ctx, data) => shares.listShareLinks(ctx, data),
});

/** One page of a link's access table. */
export const listShareAccessLogAction = defineAction({
  permission: { action: "read", resource: "share" },
  input: shareAccessLogFilterSchema,
  handler: (ctx, data) => shares.listShareAccessLog(ctx, data),
});

/**
 * A document picked in the share form's combobox, with its status and versions (for the version pin). Whoever may
 * create or edit a link may read it.
 */
export const getShareableDocumentAction = defineAction({
  permission: [
    { action: "create", resource: "share" },
    { action: "update", resource: "share" },
  ],
  input: documentIdInputSchema,
  handler: async (ctx, data) => {
    const doc = await shareableDocumentOf(ctx, data.id);
    if (!doc) throw new ServiceError("NOT_FOUND");
    return doc;
  },
});

/**
 * "Compartir un documento en el portal propone pasarlo a `ENVIADO` si estaba `APROBADO`" (PRD §8.9.4, A5): moves the
 * documents the user checked to `ENVIADO`. Only documents that are `APROBADO` now are moved; any other one is
 * reported in `skipped`, and one the service refuses in `failed`.
 */
export const markDocumentsSentAction = defineAction({
  permission: { action: "update", resource: "document" },
  input: markDocumentsSentInputSchema,
  revalidate: ["/documents", SHARES_PATH],
  handler: async (ctx, data) => {
    const sent: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const id of data.documentIds) {
      try {
        const doc = await documents.getDocument(ctx, { id });
        if (doc.status !== "APROBADO") {
          skipped.push(id);
          continue;
        }
        await documents.setDocumentStatus(ctx, { id, status: "ENVIADO" });
        sent.push(id);
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        failed.push(id);
      }
    }
    return { sent, skipped, failed };
  },
});
