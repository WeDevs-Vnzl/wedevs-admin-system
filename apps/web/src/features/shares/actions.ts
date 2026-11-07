"use server";

import { apiAction } from "@/lib/api/action";
import { toActionResult, type ApiResponseLike } from "@/lib/api/errors";
import type {
  SetShareAccessKeyResultDto,
  ShareAccessLogResponseDto,
  ShareLinkDetailDto,
  ShareLinkEditDto,
  ShareLinkFormDto,
  ShareLinkListResponseDto,
  ShareLinkMutationResultDto,
} from "@/lib/api/types/shares";
import { errorMessageKey, type ActionResult, type Paginated } from "@/lib/validators/common";
import { documentIdInputSchema } from "@/lib/validators/documents";
import {
  shareAccessLogFilterSchema,
  shareFilterSchema,
  type CreateShareLinkInput,
  type RevokeShareLinkInput,
  type UpdateShareLinkInput,
  type SetShareDocumentAccessKeyInput,
  type SetShareDocumentAccessKeyResultDTO,
  type ShareAccessLogFilterInput,
  type ShareAccessLogRowDTO,
  type ShareFilterInput,
  type ShareLinkDetailDTO,
  type ShareLinkListRowDTO,
  type ShareLinkMutationResultDTO,
} from "@/lib/validators/shares";
import { toAccessLogQuery, toShareListQuery } from "./api-query";
import {
  toAccessLogPage,
  toKeyResult,
  toMutationResult,
  toShareDetail,
  toSharePage,
} from "./mappers";
import { readShareableDocument } from "./queries";
import { markDocumentsSentInputSchema, type MarkDocumentsSentInput } from "./schemas";
import type { ShareableDocument } from "./types";

/** The submitted form: every field is decided by the user (no defaults here), only an empty message may be absent. */
type Submitted<T extends { message: string | undefined }> = Omit<T, "message"> & {
  message?: string | undefined;
};
type CreateShareLinkFormValues = Submitted<CreateShareLinkInput>;
type UpdateShareLinkFormValues = Submitted<UpdateShareLinkInput>;

// Thin API proxies (C10): token → BE call → error mapping → revalidate. The BE decides who may manage links (`share`
// is Owner and Admin only, C13) and every rule; the FE never checks `can()` here. Results that carry a clear access
// key (`generatedKeys`, `accessKey`) go back to the caller once and are kept nowhere (C22): nothing here stores,
// logs or revalidates with them.

const SHARES_PATH = "/documents/shares";
const SHARE_PATHS = [SHARES_PATH, "/documents"] as const;

/** Maps the successful result of an action; a failure passes through untouched. */
async function mapResult<TIn, TOut>(
  result: Promise<ActionResult<TIn>>,
  map: (data: TIn) => TOut,
): Promise<ActionResult<TOut>> {
  const resolved = await result;
  return resolved.ok ? { ok: true, data: map(resolved.data) } : resolved;
}

/** An invalid filter is a validation result, as the BE would answer (the filter is checked for UX only). */
const invalidInput = (): ActionResult<never> => ({
  ok: false,
  error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") },
});

const createShareLink = apiAction<CreateShareLinkFormValues, ShareLinkMutationResultDto>({
  call: (input, api) => {
    // Create may leave nullable fields out, but a version pin is always an explicit choice (DT-150).
    const body: ShareLinkFormDto = {
      title: input.title,
      allowDownload: input.allowDownload,
      locale: input.locale,
      documents: input.documents.map((doc) => ({
        documentId: doc.documentId,
        versionId: doc.versionId ?? null,
        requiresAccessKey: doc.requiresAccessKey,
      })),
      ...(input.message ? { message: input.message } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    return api.POST("/api/v1/share-links", { body });
  },
  revalidate: SHARE_PATHS,
});

/** Creates a link from a document, a client or a project; the result carries the keys generated once. */
export async function createShareLinkAction(
  input: CreateShareLinkFormValues,
): Promise<ActionResult<ShareLinkMutationResultDTO>> {
  return mapResult(createShareLink(input), toMutationResult);
}

const updateShareLink = apiAction<UpdateShareLinkFormValues, ShareLinkMutationResultDto>({
  call: ({ id, ...input }, api) => {
    // The edit is the whole form: every field is sent and what the user cleared is `null` (DT-149, no fail-open).
    const body: ShareLinkEditDto = {
      title: input.title,
      message: input.message ?? null,
      clientId: input.clientId ?? null,
      expiresAt: input.expiresAt ?? null,
      locale: input.locale,
      allowDownload: input.allowDownload,
      documents: input.documents.map((doc) => ({
        documentId: doc.documentId,
        versionId: doc.versionId ?? null,
        requiresAccessKey: doc.requiresAccessKey,
      })),
    };
    return api.PATCH("/api/v1/share-links/{id}", { params: { path: { id } }, body });
  },
  revalidate: SHARE_PATHS,
});

/** Edits title, message, locale, expiry, download and the documents (add, remove, re-pin, key on/off). */
export async function updateShareLinkAction(
  input: UpdateShareLinkFormValues,
): Promise<ActionResult<ShareLinkMutationResultDTO>> {
  return mapResult(updateShareLink(input), toMutationResult);
}

const revokeShareLink = apiAction<RevokeShareLinkInput, ShareLinkDetailDto>({
  call: ({ id }, api) => api.POST("/api/v1/share-links/{id}/revoke", { params: { path: { id } } }),
  revalidate: SHARE_PATHS,
});

/** Revokes a link: the portal then answers the generic 404. */
export async function revokeShareLinkAction(
  input: RevokeShareLinkInput,
): Promise<ActionResult<ShareLinkDetailDTO>> {
  return mapResult(revokeShareLink(input), toShareDetail);
}

const setAccessKey = apiAction<SetShareDocumentAccessKeyInput, SetShareAccessKeyResultDto>({
  call: ({ shareLinkId, documentId, action }, api) =>
    api.POST("/api/v1/share-links/{id}/documents/{documentId}/access-key", {
      params: { path: { id: shareLinkId, documentId } },
      body: { action },
    }),
  revalidate: [SHARES_PATH],
});

/** Generates, regenerates or removes the access key of one document of a link; a new key is returned once. */
export async function setShareDocumentAccessKeyAction(
  input: SetShareDocumentAccessKeyInput,
): Promise<ActionResult<SetShareDocumentAccessKeyResultDTO>> {
  return mapResult(setAccessKey(input), toKeyResult);
}

const listShareLinks = apiAction<ShareFilterInput, ShareLinkListResponseDto>({
  call: (filter, api) =>
    api.GET("/api/v1/share-links", {
      params: { query: toShareListQuery(shareFilterSchema.parse(filter)) },
    }),
});

/** One page of `/documents/shares` for the table's query. */
export async function listShareLinksAction(
  input: ShareFilterInput,
): Promise<ActionResult<Paginated<ShareLinkListRowDTO>>> {
  if (!shareFilterSchema.safeParse(input).success) return invalidInput();
  return mapResult(listShareLinks(input), toSharePage);
}

const listShareAccessLog = apiAction<ShareAccessLogFilterInput, ShareAccessLogResponseDto>({
  call: (filter, api) => {
    const parsed = shareAccessLogFilterSchema.parse(filter);
    return api.GET("/api/v1/share-links/{id}/access-log", {
      params: { path: { id: parsed.shareLinkId }, query: toAccessLogQuery(parsed) },
    });
  },
});

/** One page of a link's access table (failed unlocks included). */
export async function listShareAccessLogAction(
  input: ShareAccessLogFilterInput,
): Promise<ActionResult<Paginated<ShareAccessLogRowDTO>>> {
  if (!shareAccessLogFilterSchema.safeParse(input).success) return invalidInput();
  return mapResult(listShareAccessLog(input), toAccessLogPage);
}

/** Wraps a finished read as the response `apiAction` expects, so its error mapping and cache handling still run. */
function asResponse<T>(data: T): ApiResponseLike<T> {
  return { data, response: new Response(null, { status: 200 }) };
}

/** The error of a finished read as the response `apiAction` maps: the BE envelope shape, never prose. */
function failure(error: {
  code: string;
  message?: string;
  fieldErrors?: unknown;
}): ApiResponseLike<never> {
  const statuses: Record<string, number> = { NOT_FOUND: 404, FORBIDDEN: 403, VALIDATION: 422 };
  return {
    error: { error },
    response: new Response(null, { status: statuses[error.code] ?? 500 }),
  };
}

const getShareableDocument = apiAction<{ id: string }, ShareableDocument>({
  call: async ({ id }, api) => {
    const result = await readShareableDocument(api, id);
    if (!result.ok) return failure(result.error);
    return result.data ? asResponse(result.data) : failure({ code: "NOT_FOUND" });
  },
});

/**
 * A document picked in the share form's combobox, with its status and versions (for the version pin). The BE decides
 * who may read it; an unknown or archived document is `NOT_FOUND`.
 */
export async function getShareableDocumentAction(input: {
  id: string;
}): Promise<ActionResult<ShareableDocument>> {
  const parsed = documentIdInputSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  return getShareableDocument(parsed.data);
}

// "Compartir un documento en el portal propone pasarlo a `ENVIADO` si estaba `APROBADO`" (PRD §8.9.4, A5): the one
// multi-call action. Per checked document it reads the status and, only for `APROBADO`, asks the BE for `ENVIADO`;
// the transition rule stays the BE's (rule 13). A refusal the BE maps (4xx) lands in `failed`; a signed-out caller
// or a BE failure (5xx) fails the whole action.
const markDocumentsSent = apiAction<
  MarkDocumentsSentInput,
  { sent: string[]; skipped: string[]; failed: string[] }
>({
  call: async ({ documentIds }, api) => {
    const sent: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const id of documentIds) {
      const detail = await api.GET("/api/v1/documents/{id}", { params: { path: { id } } });
      if (!detail.data) {
        if (isRefusal(detail)) {
          failed.push(id);
          continue;
        }
        return detail as ApiResponseLike<never>;
      }
      if (detail.data.status !== "APROBADO") {
        skipped.push(id);
        continue;
      }
      const moved = await api.POST("/api/v1/documents/{id}/status", {
        params: { path: { id } },
        body: { status: "ENVIADO" },
      });
      if (moved.error !== undefined || !moved.response.ok) {
        if (isRefusal(moved)) {
          failed.push(id);
          continue;
        }
        return moved as ApiResponseLike<never>;
      }
      sent.push(id);
    }
    return asResponse({ sent, skipped, failed });
  },
  revalidate: ["/documents", SHARES_PATH],
});

/** A mapped BE refusal of one document (`403`, `404`, `409`, `422`...): not a signed-out caller, not a server failure. */
function isRefusal(result: ApiResponseLike<unknown>): boolean {
  const status = result.response.status;
  return status >= 400 && status < 500 && status !== 401 && !toActionResult(result).ok;
}

/** Moves the documents the user checked to `ENVIADO`; the ones not `APROBADO` are `skipped`, a refusal is `failed`. */
export async function markDocumentsSentAction(
  input: MarkDocumentsSentInput,
): Promise<ActionResult<{ sent: string[]; skipped: string[]; failed: string[] }>> {
  if (!markDocumentsSentInputSchema.safeParse(input).success) return invalidInput();
  return markDocumentsSent(input);
}
