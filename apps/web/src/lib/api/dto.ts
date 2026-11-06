import type { components } from "./schema";

// Generated response DTOs re-exported for code outside `src/lib/api/**`, which may not import `./schema`
// (ESLint). Code that reads part of a DTO picks from these types instead of redefining it (C8).

/** `GET /api/v1/me` and the user endpoints. */
export type UserDetailDto = components["schemas"]["UserDetailDto"];
