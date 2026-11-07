import type { components } from "../schema";

// Generated response DTOs of the global search (`GET /api/v1/search`, PRD §7.6) re-exported for code outside
// `src/lib/api/**`, which may not import `./schema` (ESLint). Re-exports only (C8).

/** `GET /api/v1/search`: the hits grouped by entity type, in the BE's order. */
export type SearchResultsDto = components["schemas"]["SearchResultsDto"];

/** One entity type's group inside `SearchResultsDto`. */
export type SearchGroupDto = SearchResultsDto["groups"][number];

/** One hit: icon by type, code, title, subtitle and the raw status (translated by the UI). */
export type SearchResultDto = SearchGroupDto["items"][number];
