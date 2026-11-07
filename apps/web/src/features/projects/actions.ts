"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { apiAction, type RevalidateTarget } from "@/lib/api/action";
import type {
  ArchivedProjectDto,
  ArchivedProjectsDto,
  ProjectDetailDto,
  ProjectLinksResponseDto,
  ProjectListResponseDto,
  ProjectStatusChangeDto,
} from "@/lib/api/types/projects";
import { errorMessageKey, type ActionResult, type EntityRef } from "@/lib/validators/common";
import { exportEntitySchema } from "@/lib/validators/export";
import {
  archiveProjectInputSchema,
  archiveProjectsInputSchema,
  createProjectInputSchema,
  projectFilterSchema,
  removeProjectLinkInputSchema,
  reorderProjectLinksInputSchema,
  setProjectClientsInputSchema,
  setProjectStatusInputSchema,
  setProjectTechnologiesInputSchema,
  updateProjectInputSchema,
  upsertProjectLinksInputSchema,
  type ProjectFilterInput,
} from "@/lib/validators/projects";
import { z } from "@/lib/validators/zod";
import { toProjectListQuery } from "./api-query";
import { PROJECT_EXPORT_COLUMNS, PROJECT_FACETS } from "./columns";

// Thin API proxies (C10): token → one BE call → error mapping → revalidate. The BE decides every grant (a Member
// updates but neither creates nor archives, PRD §4.3) and every rule (statuses, dates, locks); the FE never
// checks `can()` here and the form schemas only validate for UX. The inputs are the schemas' input types, so a
// default the form leaves out (`confirm`, `order`, empty lists) is filled in for the typed body.

// A project change also shows on the client's *Proyectos* tab, the global activity and the dashboard.
const PROJECT_PATHS: readonly RevalidateTarget[] = [
  { path: "/projects", type: "layout" },
  { path: "/clients", type: "layout" },
  { path: "/activity", type: "layout" },
];

const SEARCH_LIMIT = 20;
// `GET /projects` pages in 25/50/100: the typeahead asks for 25 and keeps the first 20.
const SEARCH_PAGE_SIZE = 25;
const searchProjectsInputSchema = z.object({
  q: z.string().trim().max(200).default(""),
});

type CreateInput = z.input<typeof createProjectInputSchema>;
type UpdateInput = z.input<typeof updateProjectInputSchema>;
type LinkInput = NonNullable<z.input<typeof upsertProjectLinksInputSchema>["links"]>[number];

/** A link as the BE takes it: the order defaults to 0. */
function linkBody({ id, group, label, url, order }: LinkInput) {
  return { ...(id ? { id } : {}), group, label, url, order: order ?? 0 };
}

export const createProjectAction = apiAction<CreateInput, ProjectDetailDto>({
  call: (input, api) =>
    api.POST("/api/v1/projects", {
      body: {
        name: input.name,
        summary: input.summary,
        clients: input.clients,
        description: input.description,
        startDate: input.startDate,
        targetEndDate: input.targetEndDate,
        endDate: input.endDate,
        status: input.status ?? "PROPUESTA",
        links: (input.links ?? []).map(linkBody),
        technologyIds: input.technologyIds ?? [],
        tagIds: input.tagIds ?? [],
      },
    }),
  revalidate: PROJECT_PATHS,
});

// Member holds RU on projects (PRD §4.3): everything but create and archive is an update, enforced by the BE.
export const updateProjectAction = apiAction<UpdateInput, ProjectDetailDto>({
  call: ({ id, ...input }, api) =>
    api.PATCH("/api/v1/projects/{id}", {
      params: { path: { id } },
      body: {
        name: input.name,
        summary: input.summary,
        clients: input.clients,
        description: input.description,
        startDate: input.startDate,
        targetEndDate: input.targetEndDate,
        endDate: input.endDate,
        technologyIds: input.technologyIds ?? [],
        tagIds: input.tagIds ?? [],
      },
    }),
  revalidate: PROJECT_PATHS,
});

/** Status change (HU-08): the response carries the project and the non-blocking hints. */
export const setProjectStatusAction = apiAction<
  z.input<typeof setProjectStatusInputSchema>,
  ProjectStatusChangeDto
>({
  call: ({ id, ...input }, api) =>
    api.POST("/api/v1/projects/{id}/status", {
      params: { path: { id } },
      body: {
        status: input.status,
        startDate: input.startDate,
        endDate: input.endDate,
        cancelPendingInstallments: input.cancelPendingInstallments ?? false,
        finishRecurringCharges: input.finishRecurringCharges ?? false,
        confirm: input.confirm ?? false,
      },
    }),
  revalidate: PROJECT_PATHS,
});

export const setProjectClientsAction = apiAction<
  z.input<typeof setProjectClientsInputSchema>,
  ProjectDetailDto
>({
  call: ({ projectId, clients }, api) =>
    api.PUT("/api/v1/projects/{id}/clients", {
      params: { path: { id: projectId } },
      body: { clients },
    }),
  revalidate: PROJECT_PATHS,
});

export const setProjectTechnologiesAction = apiAction<
  z.input<typeof setProjectTechnologiesInputSchema>,
  ProjectDetailDto
>({
  call: ({ projectId, technologyIds }, api) =>
    api.PUT("/api/v1/projects/{id}/technologies", {
      params: { path: { id: projectId } },
      body: { technologyIds },
    }),
  revalidate: PROJECT_PATHS,
});

export const upsertProjectLinksAction = apiAction<
  z.input<typeof upsertProjectLinksInputSchema>,
  ProjectLinksResponseDto
>({
  call: ({ projectId, links }, api) =>
    api.PUT("/api/v1/projects/{id}/links", {
      params: { path: { id: projectId } },
      body: { links: links.map(linkBody) },
    }),
  revalidate: PROJECT_PATHS,
});

export const reorderProjectLinksAction = apiAction<
  z.input<typeof reorderProjectLinksInputSchema>,
  ProjectLinksResponseDto
>({
  call: ({ projectId, group, orderedLinkIds }, api) =>
    api.POST("/api/v1/projects/{id}/links/reorder", {
      params: { path: { id: projectId } },
      body: { group, orderedLinkIds },
    }),
  revalidate: PROJECT_PATHS,
});

export const removeProjectLinkAction = apiAction<
  z.input<typeof removeProjectLinkInputSchema>,
  ProjectLinksResponseDto
>({
  call: ({ projectId, linkId }, api) =>
    api.DELETE("/api/v1/projects/{id}/links/{linkId}", {
      params: { path: { id: projectId, linkId } },
    }),
  revalidate: PROJECT_PATHS,
});

/** Archives one project; an open installment answers `INTEGRITY_LOCK` until `confirm` is sent (HU-08 CA3). */
export const archiveProjectAction = apiAction<
  z.input<typeof archiveProjectInputSchema>,
  ArchivedProjectDto
>({
  call: ({ id, confirm }, api) =>
    api.POST("/api/v1/projects/{id}/archive", {
      params: { path: { id } },
      body: { confirm: confirm ?? false },
    }),
  revalidate: PROJECT_PATHS,
});

export const archiveProjectsAction = apiAction<
  z.input<typeof archiveProjectsInputSchema>,
  ArchivedProjectsDto
>({
  call: ({ ids, confirm }, api) =>
    api.POST("/api/v1/projects/archive", { body: { ids, confirm: confirm ?? false } }),
  revalidate: PROJECT_PATHS,
});

const listProjects = apiAction<z.output<typeof projectFilterSchema>, ProjectListResponseDto>({
  call: (filter, api) =>
    api.GET("/api/v1/projects", { params: { query: toProjectListQuery(filter) } }),
});

const invalid = {
  ok: false,
  error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") },
} as const;

/** Reference read behind the projects table: reloads its rows when the query changes (same filter as the list). */
export async function listProjectsAction(
  input: ProjectFilterInput,
): Promise<ActionResult<ProjectListResponseDto>> {
  const parsed = projectFilterSchema.safeParse(input);
  return parsed.success ? listProjects(parsed.data) : invalid;
}

const searchProjectsPage = apiAction<string, ProjectListResponseDto>({
  call: (q, api) =>
    api.GET("/api/v1/projects", {
      params: { query: { q, pageSize: SEARCH_PAGE_SIZE, sort: "code:desc" } },
    }),
});

/** Async project combobox (note links, document links…): at most 20 `EntityRef` options matching `q`. */
export async function searchProjectsAction(
  input: z.input<typeof searchProjectsInputSchema>,
): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchProjectsInputSchema.safeParse(input);
  if (!parsed.success) return invalid;
  const page = await searchProjectsPage(parsed.data.q);
  if (!page.ok) return page;
  return {
    ok: true,
    data: page.data.items.slice(0, SEARCH_LIMIT).map((row) => ({
      type: "PROJECT" as const,
      id: row.id,
      code: row.code,
      label: row.name,
    })),
  };
}

/**
 * CSV of the table, filtered as the table is (PRD §7.3). The export source supplies the column and facet
 * metadata only; the helper calls `POST /exports/PROJECT`.
 */
export const exportProjectsCsvAction = defineCsvExportAction({
  entity: exportEntitySchema.enum.PROJECT,
  source: {
    entity: "PROJECT",
    facets: PROJECT_FACETS,
    filterSchema: projectFilterSchema,
    columns: PROJECT_EXPORT_COLUMNS,
  },
  namespace: "projects",
});
