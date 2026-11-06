import type { ApiClient } from "@/lib/api/client";
import { fromThrown, toActionResult, type ApiActionResult } from "@/lib/api/errors";
import type {
  ApiTokenDto,
  ApiTokenListItem,
  IssuedApiTokenDto,
  IssueApiTokenDto,
} from "@/lib/api/types/api-tokens";

/**
 * Calls of the personal access token endpoints (DT-189). The client is injected: the page reads the list
 * with the server client, the client component issues and revokes with the browser client, so the secret of
 * a new token goes from the BE to the dialog without crossing the Next server.
 */

/** Active tokens a user may hold (DT-189); the BE enforces it, the FE only states it. */
export const API_TOKEN_MAX_ACTIVE = 10;
export const API_TOKEN_NAME_MAX_LENGTH = 80;
export const API_TOKEN_DEFAULT_DAYS = 90;
export const API_TOKEN_MIN_DAYS = 1;
export const API_TOKEN_MAX_DAYS = 365;

async function guarded<T>(call: () => Promise<ApiActionResult<T>>): Promise<ApiActionResult<T>> {
  try {
    return await call();
  } catch (error) {
    return fromThrown(error);
  }
}

export function listApiTokens(api: ApiClient): Promise<ApiActionResult<ApiTokenListItem[]>> {
  return guarded(async () => {
    const result = toActionResult(await api.GET("/api/v1/me/api-tokens"));
    return result.ok ? { ok: true, data: result.data.items } : result;
  });
}

export function issueApiToken(
  api: ApiClient,
  input: IssueApiTokenDto,
): Promise<ApiActionResult<IssuedApiTokenDto>> {
  return guarded(async () =>
    toActionResult(await api.POST("/api/v1/me/api-tokens", { body: input })),
  );
}

export function revokeApiToken(api: ApiClient, id: string): Promise<ApiActionResult<ApiTokenDto>> {
  return guarded(async () =>
    toActionResult(
      await api.POST("/api/v1/me/api-tokens/{id}/revoke", { params: { path: { id } } }),
    ),
  );
}

/**
 * Message key to show for a key the BE sent. Two BE keys live outside this namespace
 * (`settings.apiTokens.errors.limitReached`, `validation.outOfRange`); an unknown key falls back to the
 * `fallback` (the generic validation message by default).
 */
export function apiTokenMessageKey(
  key: string,
  has: (key: string) => boolean,
  fallback = "common.errors.VALIDATION",
): string {
  if (key === "settings.apiTokens.errors.limitReached") return "apiTokens.errors.limitReached";
  if (key === "validation.outOfRange") return "apiTokens.errors.outOfRange";
  return has(key) ? key : fallback;
}
