import type { components } from "../schema";

// Generated DTOs of the personal access token endpoints, re-exported for code outside `src/lib/api/**` (C8).

/** `POST /api/v1/me/api-tokens/{id}/revoke`. */
export type ApiTokenDto = components["schemas"]["ApiTokenDto"];
/** `POST /api/v1/me/api-tokens`: the only response that carries the `secret`. */
export type IssuedApiTokenDto = components["schemas"]["IssuedApiTokenDto"];
/** Body of `POST /api/v1/me/api-tokens`. */
export type IssueApiTokenDto = components["schemas"]["IssueApiTokenDto"];
/** One row of `GET /api/v1/me/api-tokens`. */
export type ApiTokenListItem = components["schemas"]["ApiTokenListDto"]["items"][number];
