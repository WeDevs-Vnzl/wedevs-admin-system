import type { components, operations } from "../schema";

// Generated trash DTOs re-exported for code outside `src/lib/api/**`, which may not import the schema
// (ESLint). Nothing here is hand-written: each type is a view of the BE OpenAPI document (C8).

/** `GET /api/v1/trash`: one page of archived records. */
export type TrashListResponseDto = components["schemas"]["TrashListResponseDto"];

/** `GET /api/v1/trash` query: the flat keys of the list (`api-contract.md` §3). */
export type TrashListQuery = NonNullable<operations["listTrash"]["parameters"]["query"]>;

/** `POST /api/v1/trash/restore` body. */
export type RestoreFromTrashDto = components["schemas"]["RestoreFromTrashDto"];

/** `POST /api/v1/trash/restore` response. */
export type RestoredRecordResponseDto = components["schemas"]["RestoredRecordResponseDto"];
