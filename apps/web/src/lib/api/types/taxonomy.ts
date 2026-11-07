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

/** Query of `GET /api/v1/technologies`. */
export type TechnologyListQuery = NonNullable<
  operations["listTechnologies"]["parameters"]["query"]
>;
/** The `sort` tokens `GET /api/v1/technologies` accepts. */
export type TechnologyListSort = NonNullable<TechnologyListQuery["sort"]>;

/** One technology with its usage count (the detail and the write responses). */
export type TechnologyViewDto = components["schemas"]["TechnologyViewDto"];
/** `GET /api/v1/technologies`: one page of technologies. */
export type TechnologyListResponseDto = components["schemas"]["TechnologyListResponseDto"];
export type CreateTechnologyDto = components["schemas"]["CreateTechnologyDto"];
export type UpdateTechnologyDto = components["schemas"]["UpdateTechnologyDto"];
export type SetTechnologyActiveDto = components["schemas"]["SetTechnologyActiveDto"];
export type TechnologyDeletedDto = components["schemas"]["TechnologyDeletedDto"];
