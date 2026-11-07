"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { apiAction } from "@/lib/api/action";
import type {
  TechnologyDeletedDto,
  TechnologyListResponseDto,
  TechnologyViewDto,
} from "@/lib/api/types/taxonomy";
import { errorMessageKey, type ActionResult } from "@/lib/validators/common";
import type { ExportSource } from "@/lib/validators/export";
import {
  createTechnologyInputSchema,
  iconSlugSchema,
  technologyFilterSchema,
  updateTechnologyInputSchema,
  type DeleteTechnologyInput,
  type SetTechnologyActiveInput,
  type TechnologyFilter,
  type TechnologyFilterInput,
  type TechnologyListRowDTO,
} from "@/lib/validators/technologies";
import { z } from "@/lib/validators/zod";
import { exportCsv } from "@/mocks/services/export";
import * as technologies from "@/mocks/services/technologies";
import { defineAction } from "@/server/actions/define-action";
import type { ServiceContext } from "@/server/context";
import { toTechnologyListQuery } from "./api-query";
import { technologyExportColumns } from "./columns";
import { resolveTechnologyIcon } from "./icons";

const SETTINGS_PATH = "/settings/technologies";

// Settings → Tecnologías writes: thin proxies (C10). The settings grant is the BE's rule; the form validates for UX.
// The inputs are the form's zod input types (as `defineAction` took them): the dialog sends `nameEn: null` and
// omits `active` when the schema default applies, so `active` takes the schema default (`true`) for the typed body.

/** Creates a technology (settings grant). The BE answers CONFLICT on a taken name or slug. */
export const createTechnologyAction = apiAction<
  z.input<typeof createTechnologyInputSchema>,
  TechnologyViewDto
>({
  call: (input, api) =>
    api.POST("/api/v1/technologies", { body: { ...input, active: input.active ?? true } }),
  revalidate: [SETTINGS_PATH],
});

/** Replaces every editable field of a technology: the edit form submits all of them. */
export const updateTechnologyAction = apiAction<
  z.input<typeof updateTechnologyInputSchema>,
  TechnologyViewDto
>({
  call: ({ id, name, nameEn, category, iconSlug, color, active }, api) =>
    api.PATCH("/api/v1/technologies/{id}", {
      params: { path: { id } },
      body: { name, nameEn, category, iconSlug, color, active: active ?? true },
    }),
  revalidate: [SETTINGS_PATH],
});

/** Activate or deactivate: the switch in the table and the form's "active" field. */
export const setTechnologyActiveAction = apiAction<SetTechnologyActiveInput, TechnologyViewDto>({
  call: ({ id, active }, api) =>
    api.POST("/api/v1/technologies/{id}/active", { params: { path: { id } }, body: { active } }),
  revalidate: [SETTINGS_PATH],
});

/** `INTEGRITY_LOCK` when a non-archived project uses the technology (the UI offers deactivation). */
export const deleteTechnologyAction = apiAction<DeleteTechnologyInput, TechnologyDeletedDto>({
  call: ({ id }, api) => api.DELETE("/api/v1/technologies/{id}", { params: { path: { id } } }),
  revalidate: [SETTINGS_PATH],
});

const listTechnologies = apiAction<TechnologyFilter, TechnologyListResponseDto>({
  call: (filter, api) =>
    api.GET("/api/v1/technologies", { params: { query: toTechnologyListQuery(filter) } }),
});

/**
 * Reference read (DT-71): the catalog every signed-in role needs to pick technologies. The picker itself
 * reads through `queries.ts`; this is the list the client may refresh. The filter is checked for UX only.
 */
export async function listTechnologiesAction(
  input: TechnologyFilterInput,
): Promise<ActionResult<TechnologyListResponseDto>> {
  const parsed = technologyFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listTechnologies(parsed.data);
}

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
  list: (ctx: ServiceContext, filter: TechnologyFilter) =>
    technologies.listTechnologies(ctx, filter),
  columns: technologyExportColumns,
} satisfies ExportSource<TechnologyListRowDTO, TechnologyFilter, ServiceContext>;

export const exportTechnologiesCsvAction = defineCsvExportAction({
  entity: "TECHNOLOGY",
  permission: { action: "read", resource: "settings" },
  source: technologyExportSource,
  exportCsv,
  namespace: "catalogs",
});
