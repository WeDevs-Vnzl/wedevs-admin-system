"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import type { ExportSource } from "@/lib/validators/export";
import {
  createTechnologyInputSchema,
  deleteTechnologyInputSchema,
  iconSlugSchema,
  setTechnologyActiveInputSchema,
  technologyFilterSchema,
  updateTechnologyInputSchema,
  type TechnologyFilter,
  type TechnologyListRowDTO,
} from "@/lib/validators/technologies";
import { z } from "@/lib/validators/zod";
import { exportCsv } from "@/mocks/services/export";
import * as technologies from "@/mocks/services/technologies";
import { defineAction } from "@/server/actions/define-action";
import type { ServiceContext } from "@/server/context";
import { technologyExportColumns } from "./columns";
import { resolveTechnologyIcon } from "./icons";

const SETTINGS_PATH = "/settings/technologies";

/** Settings → Tecnologías writes (Owner and Admin, `settings` matrix row). */
export const createTechnologyAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: createTechnologyInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => technologies.createTechnology(ctx, data),
});

export const updateTechnologyAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateTechnologyInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => technologies.updateTechnology(ctx, data),
});

/** Activate or deactivate: the switch in the table and the form's "active" field. */
export const setTechnologyActiveAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: setTechnologyActiveInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => technologies.setTechnologyActive(ctx, data),
});

/** `INTEGRITY_LOCK` when a non-archived project uses the technology (the UI offers deactivation). */
export const deleteTechnologyAction = defineAction({
  permission: { action: "delete", resource: "settings" },
  input: deleteTechnologyInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => technologies.deleteTechnology(ctx, data),
});

/**
 * Reference read (DT-71): the catalog every signed-in role needs to pick technologies. The picker itself
 * reads through `queries.ts`; this is the list the client may refresh.
 */
export const listTechnologiesAction = defineAction({
  permission: "authenticated",
  input: technologyFilterSchema,
  handler: (ctx, data) => technologies.listTechnologies(ctx, data),
});

/**
 * Preview behind the settings form's Simple Icons field: the brand glyph of a slug, or `null`. Only the
 * roles that open Settings → Tecnologías need it (`read` on `settings`). The resolver is server only, so
 * the dialog gets plain data and never imports `simple-icons`.
 */
export const resolveTechnologyIconAction = defineAction({
  permission: { action: "read", resource: "settings" },
  input: z.object({ slug: iconSlugSchema.nullable() }),
  handler: async (_ctx, data) => resolveTechnologyIcon(data.slug),
});

// Export source (PD-2): the same list service and filter schema the table uses, so the file matches the rows.
const technologyExportSource = {
  entity: "TECHNOLOGY",
  facets: [
    { id: "category", kind: "options" },
    { id: "active", kind: "options" },
  ],
  filterSchema: technologyFilterSchema,
  list: (ctx: ServiceContext, filter: TechnologyFilter) => technologies.listTechnologies(ctx, filter),
  columns: technologyExportColumns,
} satisfies ExportSource<TechnologyListRowDTO, TechnologyFilter, ServiceContext>;

export const exportTechnologiesCsvAction = defineCsvExportAction({
  entity: "TECHNOLOGY",
  permission: { action: "read", resource: "settings" },
  source: technologyExportSource,
  exportCsv,
  namespace: "catalogs",
});
