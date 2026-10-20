import { z } from "./zod";
import { idSchema, listQuerySchema, type Paginated } from "./common";
import { documentFormatSchema } from "./enums";
import { facetOf, hexColorSchema, optionalText, requiredText, withSortFields } from "./tags";

/**
 * Document classification (PRD §8.9.1, Settings → Documentos): categories and, inside each, types.
 * Both are configurable catalogs with `name` (ES) and optional `nameEn` (PRD §7.8). Each type defines
 * what its documents may carry:
 *
 * - `requiresSignature` — enables the `FIRMADO` status and the signature date;
 * - `hasExpiration`     — enables the expiry date and its alerts;
 * - `defaultFormat`     — `MARKDOWN` · `ARCHIVO` · `ENLACE`;
 * - `active`            — inactive types cannot be picked for new documents.
 *
 * A type with documents cannot be deleted, only deactivated; a category with types cannot be deleted
 * (C19, INTEGRITY_LOCK).
 */

// ───────────────────────────── Capabilities ─────────────────────────────

/** What a document type enables; `documents.ts` validates dates and status against it. */
export const documentTypeCapabilitiesSchema = z.object({
  requiresSignature: z.boolean(),
  hasExpiration: z.boolean(),
});
export type DocumentTypeCapabilities = z.infer<typeof documentTypeCapabilitiesSchema>;

// ───────────────────────────── Inputs: categories ─────────────────────────────

const categoryFieldsShape = {
  name: requiredText(80),
  nameEn: optionalText(80),
  color: hexColorSchema.optional(),
};

/** `createDocumentCategory`. Appended after the last category. */
export const createDocumentCategoryInputSchema = z.object(categoryFieldsShape);
export type CreateDocumentCategoryInput = z.infer<typeof createDocumentCategoryInputSchema>;

export const updateDocumentCategoryInputSchema = z.object({ id: idSchema, ...categoryFieldsShape });
export type UpdateDocumentCategoryInput = z.infer<typeof updateDocumentCategoryInputSchema>;

/** `reorderDocumentCategories`: every category id, in the new order. */
export const reorderDocumentCategoriesInputSchema = z.object({
  orderedIds: z
    .array(idSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ReorderDocumentCategoriesInput = z.infer<typeof reorderDocumentCategoriesInputSchema>;

export const deleteDocumentCategoryInputSchema = z.object({ id: idSchema });
export type DeleteDocumentCategoryInput = z.infer<typeof deleteDocumentCategoryInputSchema>;

// ───────────────────────────── Inputs: types ─────────────────────────────

const typeFieldsShape = {
  categoryId: idSchema,
  name: requiredText(120),
  nameEn: optionalText(120),
  requiresSignature: z.boolean().default(false),
  hasExpiration: z.boolean().default(false),
  defaultFormat: documentFormatSchema.default("ARCHIVO"),
  active: z.boolean().default(true),
};

/** `createDocumentType`. */
export const createDocumentTypeInputSchema = z.object(typeFieldsShape);
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeInputSchema>;
export type CreateDocumentTypeFormValues = z.input<typeof createDocumentTypeInputSchema>;

export const updateDocumentTypeInputSchema = z.object({ id: idSchema, ...typeFieldsShape });
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeInputSchema>;

/** `setDocumentTypeActive`: the way to retire a type that has documents. */
export const setDocumentTypeActiveInputSchema = z.object({ id: idSchema, active: z.boolean() });
export type SetDocumentTypeActiveInput = z.infer<typeof setDocumentTypeActiveInputSchema>;

export const deleteDocumentTypeInputSchema = z.object({ id: idSchema });
export type DeleteDocumentTypeInput = z.infer<typeof deleteDocumentTypeInputSchema>;

export const documentTypeIdInputSchema = z.object({ id: idSchema });
export type DocumentTypeIdInput = z.infer<typeof documentTypeIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const DOCUMENT_TYPE_SORT_FIELDS = ["name", "category", "documentCount", "active"] as const;

export const documentTypeFilterSchema = withSortFields(
  listQuerySchema.extend({
    categoryId: facetOf(idSchema),
    active: z.union([z.boolean(), z.stringbool()]).optional(),
    requiresSignature: z.union([z.boolean(), z.stringbool()]).optional(),
    hasExpiration: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
  DOCUMENT_TYPE_SORT_FIELDS,
);
export type DocumentTypeFilter = z.infer<typeof documentTypeFilterSchema>;
export type DocumentTypeFilterInput = z.input<typeof documentTypeFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Category as shown inside a document row or a picker. */
export const documentCategoryRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
});
export type DocumentCategoryRefDTO = z.infer<typeof documentCategoryRefSchema>;

/** Type as shown inside a document row or a picker; carries the capabilities the form needs. */
export const documentTypeRefSchema = documentTypeCapabilitiesSchema.extend({
  id: idSchema,
  name: z.string(),
  nameEn: z.string().nullable(),
  defaultFormat: documentFormatSchema,
});
export type DocumentTypeRefDTO = z.infer<typeof documentTypeRefSchema>;

export const documentTypeDetailSchema = documentTypeRefSchema.extend({
  category: documentCategoryRefSchema,
  active: z.boolean(),
  /** Non-archived documents of this type. */
  documentCount: z.number().int().nonnegative(),
});
export type DocumentTypeDetailDTO = z.infer<typeof documentTypeDetailSchema>;

/** Row of the types table. */
export const documentTypeListRowSchema = documentTypeDetailSchema;
export type DocumentTypeListRowDTO = z.infer<typeof documentTypeListRowSchema>;

/** Category with its types, for the Settings tree and the grouped type picker. */
export const documentCategoryDetailSchema = documentCategoryRefSchema.extend({
  order: z.number().int().nonnegative(),
  types: z.array(documentTypeDetailSchema.omit({ category: true })),
});
export type DocumentCategoryDetailDTO = z.infer<typeof documentCategoryDetailSchema>;

// ───────────────────────────── Services ─────────────────────────────

/**
 * Document classification services (PRD §12 `settings`: "CRUD de catálogos"). Every service is
 * `fn(ctx, input) → Promise<DTO>` (C9, C11).
 */
export type DocumentTypesService<Ctx = unknown> = {
  createDocumentCategory: (
    ctx: Ctx,
    input: CreateDocumentCategoryInput,
  ) => Promise<DocumentCategoryDetailDTO>;
  updateDocumentCategory: (
    ctx: Ctx,
    input: UpdateDocumentCategoryInput,
  ) => Promise<DocumentCategoryDetailDTO>;
  reorderDocumentCategories: (
    ctx: Ctx,
    input: ReorderDocumentCategoriesInput,
  ) => Promise<DocumentCategoryDetailDTO[]>;
  deleteDocumentCategory: (
    ctx: Ctx,
    input: DeleteDocumentCategoryInput,
  ) => Promise<DeleteDocumentCategoryInput>;
  listDocumentCategories: (ctx: Ctx) => Promise<DocumentCategoryDetailDTO[]>;
  createDocumentType: (ctx: Ctx, input: CreateDocumentTypeInput) => Promise<DocumentTypeDetailDTO>;
  updateDocumentType: (ctx: Ctx, input: UpdateDocumentTypeInput) => Promise<DocumentTypeDetailDTO>;
  setDocumentTypeActive: (
    ctx: Ctx,
    input: SetDocumentTypeActiveInput,
  ) => Promise<DocumentTypeDetailDTO>;
  deleteDocumentType: (
    ctx: Ctx,
    input: DeleteDocumentTypeInput,
  ) => Promise<DeleteDocumentTypeInput>;
  listDocumentTypes: (
    ctx: Ctx,
    input: DocumentTypeFilter,
  ) => Promise<Paginated<DocumentTypeListRowDTO>>;
  getDocumentType: (ctx: Ctx, input: DocumentTypeIdInput) => Promise<DocumentTypeDetailDTO>;
};
