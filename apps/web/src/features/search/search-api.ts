import type { ApiClient } from "@/lib/api/client";
import { fromThrown, toActionResult, type ApiActionResult } from "@/lib/api/errors";
import type { SearchResultsDto } from "@/lib/api/types/search";
import type { SearchableEntityType } from "@/lib/validators/search";

/** What the Cmd+K menu asks for. `q` is what the user typed, prefix included (the BE applies it). */
export interface GlobalSearchRequest {
  q: string;
  entityTypes?: SearchableEntityType[];
  /** Archived rows come back only when the user asks for them (HU-28 CA1). */
  includeArchived?: boolean;
  limit?: number;
}

/**
 * `GET /api/v1/search` through the browser client. The BE decides what the caller may read and matches
 * accents, typos and codes; the FE only sends the request and maps the answer (C1, DT-205). Nothing here
 * is a domain rule, so a failure is the error envelope or `INTERNAL`.
 */
export async function searchGlobalRecords(
  api: ApiClient,
  request: GlobalSearchRequest,
): Promise<ApiActionResult<SearchResultsDto>> {
  try {
    const query = {
      q: request.q,
      ...(request.entityTypes ? { entityTypes: request.entityTypes } : {}),
      ...(request.includeArchived ? { includeArchived: "true" as const } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    };
    return toActionResult(await api.GET("/api/v1/search", { params: { query } }));
  } catch (error) {
    return fromThrown(error);
  }
}
