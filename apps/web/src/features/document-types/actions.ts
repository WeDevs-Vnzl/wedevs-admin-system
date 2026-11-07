"use server";

import { apiAction } from "@/lib/api/action";
import type {
  DeletedRefDto,
  DocumentCategoryResponseDto,
  DocumentTypeBodyDto,
  DocumentTypeDetailDto,
} from "@/lib/api/types/taxonomy";
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

// Settings → Tipos de documento writes (settings grant, Owner and Admin). Thin API proxies (C10): the BE decides
// the grant and the lock rules; the forms validate for UX only. The inputs are the forms' zod input types.
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

// ───────────────────────────── Types ─────────────────────────────

type DocumentTypeFields = z.input<typeof createDocumentTypeInputSchema>;

/**
 * The typed body of a document type. The schema defaults (`active`, `defaultFormat`, `hasExpiration`,
 * `requiresSignature`) are applied here, so the body carries every field the BE replaces.
 */
function toTypeBody(fields: DocumentTypeFields): DocumentTypeBodyDto {
  return {
    categoryId: fields.categoryId,
    name: fields.name,
    nameEn: fields.nameEn,
    active: fields.active ?? true,
    defaultFormat: fields.defaultFormat ?? "ARCHIVO",
    hasExpiration: fields.hasExpiration ?? false,
    requiresSignature: fields.requiresSignature ?? false,
  };
}

/** Creates a type inside a category. The BE answers VALIDATION on an unknown category, CONFLICT on a taken name. */
export const createDocumentTypeAction = apiAction<DocumentTypeFields, DocumentTypeDetailDto>({
  call: (input, api) => api.POST("/api/v1/document-types", { body: toTypeBody(input) }),
  revalidate: [SETTINGS_PATH],
});

export const updateDocumentTypeAction = apiAction<
  z.input<typeof updateDocumentTypeInputSchema>,
  DocumentTypeDetailDto
>({
  call: ({ id, ...fields }, api) =>
    api.PATCH("/api/v1/document-types/{id}", {
      params: { path: { id } },
      body: toTypeBody(fields),
    }),
  revalidate: [SETTINGS_PATH],
});

/** Activate or deactivate: the way to retire a type that documents use (HU-21 CA2). */
export const setDocumentTypeActiveAction = apiAction<
  z.input<typeof setDocumentTypeActiveInputSchema>,
  DocumentTypeDetailDto
>({
  call: ({ id, active }, api) =>
    api.POST("/api/v1/document-types/{id}/active", { params: { path: { id } }, body: { active } }),
  revalidate: [SETTINGS_PATH],
});

/** `INTEGRITY_LOCK` when any document uses the type (the UI offers deactivation). */
export const deleteDocumentTypeAction = apiAction<
  z.input<typeof deleteDocumentTypeInputSchema>,
  DeletedRefDto
>({
  call: ({ id }, api) => api.DELETE("/api/v1/document-types/{id}", { params: { path: { id } } }),
  revalidate: [SETTINGS_PATH],
});
