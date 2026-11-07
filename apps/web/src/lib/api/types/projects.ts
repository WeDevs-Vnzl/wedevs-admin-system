import type { components, operations } from "../schema";

// Generated project DTOs and query types re-exported for the projects module: code outside `src/lib/api/**`
// may not import the schema (ESLint, C8).

/** Query of `GET /api/v1/projects`. */
export type ProjectListQuery = NonNullable<operations["listProjects"]["parameters"]["query"]>;
/** The `sort` tokens `GET /api/v1/projects` accepts. */
export type ProjectListSort = NonNullable<ProjectListQuery["sort"]>;

/**
 * One project (`GET /projects/{id}` and the write responses). The four money fields are `null` for roles
 * without the finance grant (C13).
 */
export type ProjectDetailDto = components["schemas"]["ProjectDetailDto"];
/** `GET /api/v1/projects`: one page of table rows. */
export type ProjectListResponseDto = components["schemas"]["ProjectListResponseDto"];
/** One row of the projects table. */
export type ProjectListRowDto = ProjectListResponseDto["items"][number];
/** One link of a project. */
export type ProjectLinkDto = ProjectDetailDto["links"][number];
/** `POST /api/v1/projects/{id}/status`: the project plus the non-blocking hints. */
export type ProjectStatusChangeDto = components["schemas"]["ProjectStatusChangeDto"];
/** Link writes: the project's links after the change. */
export type ProjectLinksResponseDto = components["schemas"]["ProjectLinksResponseDto"];
/** `GET /api/v1/projects/overview`. */
export type ProjectsOverviewDto = components["schemas"]["ProjectsOverviewDto"];
/** `GET /api/v1/projects/{id}/summary`. */
export type ProjectSummaryResponseDto = components["schemas"]["ProjectSummaryResponseDto"];
export type ArchivedProjectDto = components["schemas"]["ArchivedProjectDto"];
export type ArchivedProjectsDto = components["schemas"]["ArchivedProjectsDto"];

export type CreateProjectDto = components["schemas"]["CreateProjectDto"];
export type UpdateProjectDto = components["schemas"]["UpdateProjectDto"];
export type SetProjectStatusDto = components["schemas"]["SetProjectStatusDto"];
export type SetProjectClientsDto = components["schemas"]["SetProjectClientsDto"];
export type SetProjectTechnologiesDto = components["schemas"]["SetProjectTechnologiesDto"];
export type UpsertProjectLinksDto = components["schemas"]["UpsertProjectLinksDto"];
export type ReorderProjectLinksDto = components["schemas"]["ReorderProjectLinksDto"];
