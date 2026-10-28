import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { idSchema, VALIDATION_MESSAGES } from '../../../../../shared/interface/common.schemas';
import { RAW_TEXT_MAX, documentTypeViewSchema } from './document-types.dto';

/**
 * Request body of `POST /document-categories` and `PATCH /document-categories/{id}` (the FE
 * `documentCategoryInput`). Shape and the raw bound only; trimming, blank handling, the 80-character limit and
 * the `#RRGGBB` colour are domain rules (`validation.*` fields).
 */
export const documentCategoryBodySchema = z.object({
  name: z.string().max(RAW_TEXT_MAX),
  nameEn: z.string().max(RAW_TEXT_MAX).nullish(),
  color: z.string().max(16).nullish(),
});
export class DocumentCategoryBodyDto extends createZodDto(documentCategoryBodySchema) {}

/** Request body of `POST /document-categories/reorder`: every category id, once, in the new order. */
export const reorderDocumentCategoriesSchema = z.object({
  orderedIds: z
    .array(idSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: VALIDATION_MESSAGES.invalidFormat,
    }),
});
export class ReorderDocumentCategoriesDto extends createZodDto(reorderDocumentCategoriesSchema) {}

/** A category with its types, for the settings tree and the grouped picker. */
export const documentCategoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
  order: z.number().int().nonnegative(),
  types: z.array(documentTypeViewSchema),
});
export class DocumentCategoryResponseDto extends createZodDto(documentCategoryResponseSchema) {}
