import type { components } from "../schema";

// Generated graph response DTOs for code outside `src/lib/api/**` (ESLint). Re-exports only (C8): the FE never
// retypes the contract. The global response carries `stats`, which the canvas recomputes for the visible subset.

/** `GET /api/v1/graph/{type}/{id}` and `GET /api/v1/graph/nodes/{nodeId}/neighbours`. */
export type GraphResponseDto = components["schemas"]["GraphResponseDto"];

/** `GET /api/v1/graph` (the same nodes, edges and truncated items, plus `stats`). */
export type GlobalGraphResponseDto = components["schemas"]["GlobalGraphResponseDto"];
