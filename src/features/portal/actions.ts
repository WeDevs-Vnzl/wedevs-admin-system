"use server";

import {
  getSharedDocumentActionSchema,
  unlockSharedDocumentActionSchema,
} from "@/lib/validators/shares";
import * as portal from "@/mocks/services/portal-shares";
import { definePublicAction } from "@/server/actions/define-public-action";
import { rememberUnlockedDocument } from "@/server/portal/portal-request";

// Public actions of the portal `/s/[token]` (PRD §8.11, DT-45, C10, C22). Built only with `definePublicAction`:
// token → link → zod (action schema) → request metadata → service. They never read the session. The access key
// travels only in the unlock request body, never in a URL, and is never logged.

/** Checks the key of one document; on success the signed unlock cookie remembers it for the rest of the visit. */
export const unlockSharedDocumentAction = definePublicAction({
  input: unlockSharedDocumentActionSchema,
  resolveToken: portal.findLiveShareLink,
  handler: async (ctx, { data, request }) => {
    const result = await portal.unlockSharedDocument(ctx, { ...data, ...request });
    await rememberUnlockedDocument(data.token, request.unlockedDocumentIds, data.documentId);
    return result;
  },
});

/** Opens one document in the viewer: its content (markdown, file description or link) plus a `VIEW` log row. */
export const openSharedDocumentAction = definePublicAction({
  input: getSharedDocumentActionSchema,
  resolveToken: portal.findLiveShareLink,
  handler: async (ctx, { data, request }) => {
    const view = await portal.getSharedDocument(ctx, { ...data, ...request });
    await portal.recordShareAccess(ctx, {
      token: data.token,
      documentId: data.documentId,
      event: "VIEW",
      ipHash: request.ipHash,
      ...(request.userAgent ? { userAgent: request.userAgent } : {}),
    });
    return view;
  },
});
