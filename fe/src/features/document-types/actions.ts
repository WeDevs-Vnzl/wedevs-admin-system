"use server";

import {
  createDocumentCategoryInputSchema,
  createDocumentTypeInputSchema,
  deleteDocumentCategoryInputSchema,
  deleteDocumentTypeInputSchema,
  reorderDocumentCategoriesInputSchema,
  setDocumentTypeActiveInputSchema,
  updateDocumentCategoryInputSchema,
  updateDocumentTypeInputSchema,
} from "@/lib/validators/document-types";
import * as documentTypes from "@/mocks/services/document-types";
import { defineAction } from "@/server/actions/define-action";

// Settings → Tipos de documento writes (Owner and Admin, `settings` matrix row, like every catalog).
const SETTINGS_PATH = "/settings/document-types";

// ───────────────────────────── Categories ─────────────────────────────

export const createDocumentCategoryAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: createDocumentCategoryInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.createDocumentCategory(ctx, data),
});

export const updateDocumentCategoryAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateDocumentCategoryInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.updateDocumentCategory(ctx, data),
});

/** Every category id in the new order (the move up and move down buttons send the whole list). */
export const reorderDocumentCategoriesAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: reorderDocumentCategoriesInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.reorderDocumentCategories(ctx, data),
});

/** `INTEGRITY_LOCK` when the category still has types. */
export const deleteDocumentCategoryAction = defineAction({
  permission: { action: "delete", resource: "settings" },
  input: deleteDocumentCategoryInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.deleteDocumentCategory(ctx, data),
});

// ───────────────────────────── Types ─────────────────────────────

export const createDocumentTypeAction = defineAction({
  permission: { action: "create", resource: "settings" },
  input: createDocumentTypeInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.createDocumentType(ctx, data),
});

export const updateDocumentTypeAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateDocumentTypeInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.updateDocumentType(ctx, data),
});

/** Activate or deactivate: the way to retire a type that documents use (HU-21 CA2). */
export const setDocumentTypeActiveAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: setDocumentTypeActiveInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.setDocumentTypeActive(ctx, data),
});

/** `INTEGRITY_LOCK` when any document uses the type (the UI offers deactivation). */
export const deleteDocumentTypeAction = defineAction({
  permission: { action: "delete", resource: "settings" },
  input: deleteDocumentTypeInputSchema,
  revalidate: [SETTINGS_PATH],
  handler: (ctx, data) => documentTypes.deleteDocumentType(ctx, data),
});
