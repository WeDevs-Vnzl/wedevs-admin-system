"use server";

import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { entityHref } from "@/lib/entity-routes";
import {
  assignTagsInputSchema,
  createTagInputSchema,
  tagFilterSchema,
  unassignTagInputSchema,
  updateTagInputSchema,
} from "@/lib/validators/tags";
import { exportCsv } from "@/mocks/services/export";
import * as tags from "@/mocks/services/tags";
import { defineAction } from "@/server/actions/define-action";
import { TAG_EXPORT_COLUMNS } from "./columns";

const SETTINGS_TAGS_PATH = "/settings/tags";

/**
 * Creates a tag. Anyone who may create a settings record, or who may edit a client, project, note or document,
 * may create one inline from that record (Member: notes and documents, PRD §4.3).
 */
export const createTagAction = defineAction({
  permission: [
    { action: "create", resource: "settings" },
    { action: "update", resource: "client" },
    { action: "update", resource: "project" },
    { action: "create", resource: "note" },
    { action: "create", resource: "document" },
  ],
  input: createTagInputSchema,
  revalidate: [SETTINGS_TAGS_PATH],
  handler: (ctx, data) => tags.createTag(ctx, data),
});

/** Renames or recolours a tag (Owner and Admin). */
export const updateTagAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateTagInputSchema,
  revalidate: [SETTINGS_TAGS_PATH],
  handler: (ctx, data) => tags.updateTag(ctx, data),
});

/**
 * Tags an entity. The entity's own `can()` check runs in the service (a Member tags projects and notes, not
 * clients); here any taggable update passes the gate.
 */
export const assignTagsAction = defineAction({
  permission: [
    { action: "update", resource: "client" },
    { action: "update", resource: "contact" },
    { action: "update", resource: "project" },
    { action: "update", resource: "document" },
    { action: "update", resource: "note" },
    { action: "update", resource: "invoice" },
    { action: "update", resource: "payment" },
    { action: "update", resource: "expense" },
  ],
  input: assignTagsInputSchema,
  revalidate: (data) => {
    const href = entityHref({ type: data.entityType, id: data.entityId });
    return href ? [SETTINGS_TAGS_PATH, href] : [SETTINGS_TAGS_PATH];
  },
  handler: (ctx, data) => tags.assignTags(ctx, data),
});

/** Removes a tag from an entity; same gate as `assignTagsAction`. */
export const unassignTagAction = defineAction({
  permission: [
    { action: "update", resource: "client" },
    { action: "update", resource: "contact" },
    { action: "update", resource: "project" },
    { action: "update", resource: "document" },
    { action: "update", resource: "note" },
    { action: "update", resource: "invoice" },
    { action: "update", resource: "payment" },
    { action: "update", resource: "expense" },
  ],
  input: unassignTagInputSchema,
  revalidate: (data) => {
    const href = entityHref({ type: data.entityType, id: data.entityId });
    return href ? [SETTINGS_TAGS_PATH, href] : [SETTINGS_TAGS_PATH];
  },
  handler: (ctx, data) => tags.unassignTag(ctx, data),
});

/** Reference read behind the picker and the table (tag names and colours are catalogue data, DT-71). */
export const listTagsAction = defineAction({
  permission: "authenticated",
  input: tagFilterSchema,
  handler: (ctx, data) => tags.listTags(ctx, data),
});

/** CSV of the Settings table, filtered as the table is (PRD §7.3). */
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
