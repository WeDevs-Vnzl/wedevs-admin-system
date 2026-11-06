import type { components, operations } from "../schema";

// Generated taxonomy DTOs and query types re-exported for the tags, technologies and document-type
// modules: code outside `src/lib/api/**` may not import the schema (ESLint, C8).

/** Query of `GET /api/v1/tags`. */
export type TagListQuery = NonNullable<operations["listTags"]["parameters"]["query"]>;
/** The `sort` tokens `GET /api/v1/tags` accepts. */
export type TagListSort = NonNullable<TagListQuery["sort"]>;

/** One tag with its usage count. */
export type TagDto = components["schemas"]["TagDto"];
/** `GET /api/v1/tags`: one page of tags. */
export type TagListResponseDto = components["schemas"]["TagListResponseDto"];
/** `POST /api/v1/tags/assign` and `/unassign`: the record's tags after the write. */
export type TagChipsResponseDto = components["schemas"]["TagChipsResponseDto"];
export type CreateTagDto = components["schemas"]["CreateTagDto"];
export type UpdateTagDto = components["schemas"]["UpdateTagDto"];
export type AssignTagsDto = components["schemas"]["AssignTagsDto"];
export type UnassignTagDto = components["schemas"]["UnassignTagDto"];
