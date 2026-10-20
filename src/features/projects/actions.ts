"use server";

import { z } from "@/lib/validators/zod";
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
} from "@/lib/validators/projects";
import type { EntityRef } from "@/lib/validators/common";
import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { exportCsv } from "@/mocks/services/export";
import * as projects from "@/mocks/services/projects";
import { defineAction, type RevalidateTarget } from "@/server/actions/define-action";
import { PROJECT_EXPORT_COLUMNS, PROJECT_FACETS } from "./columns";

// A project change also shows on the client's *Proyectos* tab, the global activity and the dashboard.
const PROJECT_PATHS: readonly RevalidateTarget[] = [
  { path: "/projects", type: "layout" },
  { path: "/clients", type: "layout" },
  { path: "/activity", type: "layout" },
];

const SEARCH_LIMIT = 20;
const searchProjectsInputSchema = z.object({
  q: z.string().trim().max(200).default(""),
});

export const createProjectAction = defineAction({
  permission: { action: "create", resource: "project" },
  input: createProjectInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.createProject(ctx, data),
});

// Member holds RU on projects (PRD §4.3): everything but create and archive is an `update`.
export const updateProjectAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: updateProjectInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.updateProject(ctx, data),
});

export const setProjectStatusAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: setProjectStatusInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.setProjectStatus(ctx, data),
});

export const setProjectClientsAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: setProjectClientsInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.setProjectClients(ctx, data),
});

export const setProjectTechnologiesAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: setProjectTechnologiesInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.setProjectTechnologies(ctx, data),
});

export const upsertProjectLinksAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: upsertProjectLinksInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.upsertProjectLinks(ctx, data),
});

export const reorderProjectLinksAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: reorderProjectLinksInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.reorderProjectLinks(ctx, data),
});

export const removeProjectLinkAction = defineAction({
  permission: { action: "update", resource: "project" },
  input: removeProjectLinkInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.removeProjectLink(ctx, data),
});

export const archiveProjectAction = defineAction({
  permission: { action: "delete", resource: "project" },
  input: archiveProjectInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.archiveProject(ctx, data),
});

export const archiveProjectsAction = defineAction({
  permission: { action: "delete", resource: "project" },
  input: archiveProjectsInputSchema,
  revalidate: PROJECT_PATHS,
  handler: (ctx, data) => projects.archiveProjects(ctx, data),
});

/** Reference read behind the projects table: reloads its rows when the query changes (same filter as the list). */
export const listProjectsAction = defineAction({
  permission: { action: "read", resource: "project" },
  input: projectFilterSchema,
  handler: (ctx, data) => projects.listProjects(ctx, data),
});

/** Async project combobox (note links, document links…): at most 20 `EntityRef` options matching `q`. */
export const searchProjectsAction = defineAction({
  permission: { action: "read", resource: "project" },
  input: searchProjectsInputSchema,
  handler: async (ctx, data): Promise<EntityRef[]> => {
    const page = await projects.listProjects(
      ctx,
      projectFilterSchema.parse({ q: data.q, pageSize: 25, sort: "code:desc" }),
    );
    return page.items.slice(0, SEARCH_LIMIT).map((row) => ({
      id: row.id,
      code: row.code,
      label: row.name,
      type: "PROJECT" as const,
    }));
  },
});

export const exportProjectsCsvAction = defineCsvExportAction({
  entity: exportEntitySchema.enum.PROJECT,
  permission: { action: "read", resource: "project" },
  source: {
    entity: "PROJECT",
    facets: PROJECT_FACETS,
    filterSchema: projectFilterSchema,
    list: projects.listProjects,
    columns: PROJECT_EXPORT_COLUMNS,
  },
  exportCsv,
  namespace: "projects",
});
