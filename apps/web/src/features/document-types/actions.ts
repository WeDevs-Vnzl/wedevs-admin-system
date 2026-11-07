"use server";

import { apiAction } from "@/lib/api/action";
import type { DeletedRefDto, DocumentCategoryResponseDto } from "@/lib/api/types/taxonomy";
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
import { z } from "@/lib/validators/zod";
import * as documentTypes from "@/mocks/services/document-types";
import { defineAction } from "@/server/actions/define-action";

// Settings → Tipos de documento writes (settings grant, Owner and Admin). The category writes are thin API
// proxies (C10): the BE decides the grant and the lock rules; the forms validate for UX only.
// The inputs are the forms' zod input types, as `defineAction` took them.
const SETTINGS_PATH = "/settings/document-types";

// ───────────────────────────── Categories ─────────────────────────────

/** Creates a category at the end of the list. */
export const createDocumentCategoryAction = apiAction<
  z.input<typeof createDocumentCategoryInputSchema>,
  DocumentCategoryResponseDto
>({
  call: (input, api) => api.POST("/api/v1/document-categories", { body: input }),
  revalidate: [SETTINGS_PATH],
});

export const updateDocumentCategoryAction = apiAction<
  z.input<typeof updateDocumentCategoryInputSchema>,
  DocumentCategoryResponseDto
>({
  call: ({ id, ...body }, api) =>
    api.PATCH("/api/v1/document-categories/{id}", { params: { path: { id } }, body }),
  revalidate: [SETTINGS_PATH],
});

/** Every category id in the new order (the move up and move down buttons send the whole list). */
export const reorderDocumentCategoriesAction = apiAction<
  z.input<typeof reorderDocumentCategoriesInputSchema>,
  DocumentCategoryResponseDto[]
>({
  call: (input, api) => api.POST("/api/v1/document-categories/reorder", { body: input }),
  revalidate: [SETTINGS_PATH],
});

/** `INTEGRITY_LOCK` when the category still has types. */
export const deleteDocumentCategoryAction = apiAction<
  z.input<typeof deleteDocumentCategoryInputSchema>,
  DeletedRefDto
>({
  call: ({ id }, api) =>
    api.DELETE("/api/v1/document-categories/{id}", { params: { path: { id } } }),
  revalidate: [SETTINGS_PATH],
});

// ───────────────────────────── Types (still on the mock seam) ─────────────────────────────

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
