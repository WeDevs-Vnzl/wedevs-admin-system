"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { apiAction } from "@/lib/api/action";
import type { TagChipsResponseDto, TagDto, TagListResponseDto } from "@/lib/api/types/taxonomy";
import { entityHref } from "@/lib/entity-routes";
import { errorMessageKey, type ActionResult } from "@/lib/validators/common";
import {
  tagFilterSchema,
  type AssignTagsInput,
  type CreateTagInput,
  type TagChipDTO,
  type TagFilter,
  type TagFilterInput,
  type UnassignTagInput,
  type UpdateTagInput,
} from "@/lib/validators/tags";
import { exportCsv } from "@/mocks/services/export";
import * as tags from "@/mocks/services/tags";
import { toTagListQuery } from "./api-query";
import { TAG_EXPORT_COLUMNS } from "./columns";

// Thin API proxies (C10): token → one BE call → error mapping → revalidate. The BE decides every grant
// (a Member tags projects and notes, not clients); the FE never checks `can()` here.

const SETTINGS_TAGS_PATH = "/settings/tags";

/** The Settings table and the record the tags were changed on (its own page shows its tags). */
function tagRevalidation(input: Pick<AssignTagsInput, "entityType" | "entityId">) {
  const href = entityHref({ type: input.entityType, id: input.entityId });
  return href ? [SETTINGS_TAGS_PATH, href] : [SETTINGS_TAGS_PATH];
}

/** Creates a tag. The BE accepts it from Settings, and inline from a client, project, note or document. */
export const createTagAction = apiAction<CreateTagInput, TagDto>({
  call: (input, api) => api.POST("/api/v1/tags", { body: input }),
  revalidate: [SETTINGS_TAGS_PATH],
});

/** Renames or recolours a tag (settings grant). */
export const updateTagAction = apiAction<UpdateTagInput, TagDto>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/tags/{id}", { params: { path: { id } }, body }),
  revalidate: [SETTINGS_TAGS_PATH],
});

const assignTags = apiAction<AssignTagsInput, TagChipsResponseDto>({
  call: (input, api) => api.POST("/api/v1/tags/assign", { body: input }),
  revalidate: tagRevalidation,
});

/** Tags one record; resolves to the record's tags. */
export async function assignTagsAction(
  input: AssignTagsInput,
): Promise<ActionResult<TagChipDTO[]>> {
  const result = await assignTags(input);
  return result.ok ? { ok: true, data: result.data.items } : result;
}

const unassignTag = apiAction<UnassignTagInput, TagChipsResponseDto>({
  call: (input, api) => api.POST("/api/v1/tags/unassign", { body: input }),
  revalidate: tagRevalidation,
});

/** Removes one tag from one record; resolves to the record's remaining tags. */
export async function unassignTagAction(
  input: UnassignTagInput,
): Promise<ActionResult<TagChipDTO[]>> {
  const result = await unassignTag(input);
  return result.ok ? { ok: true, data: result.data.items } : result;
}

const listTags = apiAction<TagFilter, TagListResponseDto>({
  call: (filter, api) => api.GET("/api/v1/tags", { params: { query: toTagListQuery(filter) } }),
});

/**
 * Reference read behind the picker and the table (tag names and colours are catalogue data, DT-71). Any signed-in
 * role reads it; the filter is checked for UX only, the BE re-validates.
 */
export async function listTagsAction(
  input: TagFilterInput,
): Promise<ActionResult<TagListResponseDto>> {
  const parsed = tagFilterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return listTags(parsed.data);
}

/**
 * CSV of the Settings table, filtered as the table is (PRD §7.3). The export source keeps the mock list for
 * its column and facet metadata only; the helper calls `POST /exports/TAG`.
 */
export const exportTagsCsvAction = defineCsvExportAction({
  entity: "TAG",
  permission: { action: "read", resource: "settings" },
  source: {
    entity: "TAG",
    facets: [],
    filterSchema: tagFilterSchema,
    list: tags.listTags,
    columns: TAG_EXPORT_COLUMNS,
  },
  exportCsv,
  namespace: "tags",
});
