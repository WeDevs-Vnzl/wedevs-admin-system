import { toActionResult, type ApiActionResult } from "@/lib/api/errors";
import type { ApiClient } from "@/lib/api/client";
import type { PortalDocumentViewDto, PortalShareDto } from "@/lib/api/types/portal";

// Calls of the public portal over `/api/v1/portal/**` (PRD §8.11, C22). Every wrapper takes the portal client
// (no token, credentials included) and answers an `ApiActionResult`; a rejected fetch propagates to the caller.

const NO_STORE = { cache: "no-store" } as const;

/** The portal page of a link. No side effect and no log row on the BE: the visit is recorded by `recordPortalView`. */
export async function fetchPortalPage(
  api: ApiClient,
  token: string,
): Promise<ApiActionResult<PortalShareDto>> {
  return toActionResult(
    await api.GET("/api/v1/portal/{token}", { params: { path: { token } }, ...NO_STORE }),
  );
}

/** What the viewer renders for one document; a locked document is `FORBIDDEN`. */
export async function fetchPortalDocument(
  api: ApiClient,
  token: string,
  documentId: string,
): Promise<ApiActionResult<PortalDocumentViewDto>> {
  return toActionResult(
    await api.GET("/api/v1/portal/{token}/documents/{documentId}", {
      params: { path: { token, documentId } },
      ...NO_STORE,
    }),
  );
}

/** Checks the access key of one document; the key travels only in the body. A right key sets the BE cookie. */
export async function unlockPortalDocument(
  api: ApiClient,
  token: string,
  documentId: string,
  key: string,
): Promise<ApiActionResult<{ documentId: string; unlocked: true }>> {
  return toActionResult(
    await api.POST("/api/v1/portal/{token}/documents/{documentId}/unlock", {
      params: { path: { token, documentId } },
      body: { key },
    }),
  );
}

/** Logs a `VIEW` of the link (no `documentId`) or of one of its documents. */
export async function recordPortalView(
  api: ApiClient,
  token: string,
  documentId?: string,
): Promise<ApiActionResult<{ recorded: true }>> {
  return toActionResult(
    await api.POST("/api/v1/portal/{token}/views", {
      params: { path: { token } },
      body: documentId ? { documentId } : {},
    }),
  );
}
