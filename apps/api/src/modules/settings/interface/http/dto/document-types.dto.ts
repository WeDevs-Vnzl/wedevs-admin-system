import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DOCUMENT_FORMAT_VALUES } from '../../../../../shared/domain/enums';
import { parseSort, type SortSpec } from '../../../../../shared/domain/list-query';
import { DEFAULT_PAGE_SIZE } from '../../../../../shared/domain/pagination';
import { idSchema, VALIDATION_MESSAGES } from '../../../../../shared/interface/common.schemas';
import {
  DOCUMENT_TYPE_SORT_FIELDS,
  type DocumentTypeListQuery,
} from '../../../application/use-cases/list-document-types.use-case';

/**
 * Raw safety bound of a text field. The trimmed limits (80 / 120 characters) are domain rules that answer
 * `validation.tooLong` on the field; this bound only keeps a request body from carrying an unbounded string.
 */
export const RAW_TEXT_MAX = 1000;

export const documentFormatSchema = z.enum(DOCUMENT_FORMAT_VALUES);

/** Request body of `POST /document-types` and `PATCH /document-types/{id}` (the FE `documentTypeInput`). */
export const documentTypeBodySchema = z.object({
  categoryId: idSchema,
  name: z.string().max(RAW_TEXT_MAX),
  nameEn: z.string().max(RAW_TEXT_MAX).nullish(),
  requiresSignature: z.boolean().default(false),
  hasExpiration: z.boolean().default(false),
  defaultFormat: documentFormatSchema.default('ARCHIVO'),
  active: z.boolean().default(true),
});
export class DocumentTypeBodyDto extends createZodDto(documentTypeBodySchema) {}

/** Request body of `POST /document-types/{id}/active`. */
export const setDocumentTypeActiveSchema = z.object({ active: z.boolean() });
export class SetDocumentTypeActiveDto extends createZodDto(setDocumentTypeActiveSchema) {}

/** Category as shown inside a type row. */
export const documentCategoryRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
});
export class DocumentCategoryRefDto extends createZodDto(documentCategoryRefSchema) {}

/** A type as shown in a category tree or a picker. `documentCount` is never absent (nullability rule). */
export const documentTypeViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  defaultFormat: documentFormatSchema,
  requiresSignature: z.boolean(),
  hasExpiration: z.boolean(),
  active: z.boolean(),
  documentCount: z.number().int().nonnegative(),
});
export class DocumentTypeViewDto extends createZodDto(documentTypeViewSchema) {}

/** A type with its category: the detail read and the list rows. */
export const documentTypeDetailSchema = documentTypeViewSchema.extend({
  category: documentCategoryRefSchema,
});
export class DocumentTypeDetailDto extends createZodDto(documentTypeDetailSchema) {}

export const documentTypeListResponseSchema = z.object({
  items: z.array(documentTypeDetailSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class DocumentTypeListResponseDto extends createZodDto(documentTypeListResponseSchema) {}

/** Response of a hard delete: the id of the removed row. */
export const deletedRefSchema = z.object({ id: z.string() });
export class DeletedRefDto extends createZodDto(deletedRefSchema) {}

/** Sort tokens of the list: the whitelist is the use case's (`DOCUMENT_TYPE_SORT_FIELDS`). */
const DEFAULT_SORT: SortSpec = { field: 'name', direction: 'asc' };

/** A single value or repeated query keys (`?categoryId=a&categoryId=b`), normalized to a list. */
const facetOfIds = z
  .union([idSchema, z.array(idSchema)])
  .optional()
  .transform((value): string[] | undefined =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value],
  );

/**
 * Query of `GET /document-types` (`api-contract.md` §3). It mirrors the shared list query (page, pageSize,
 * sort, q) with the facets of the type list. It has no `archived` parameter: a document type is never
 * soft-deleted (data-rules.md §6), so an archived view does not exist. Unknown keys are dropped.
 */
export const documentTypeListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
      .default(DEFAULT_PAGE_SIZE),
    sort: z
      .string()
      .optional()
      .transform((value, ctx): SortSpec => {
        if (value === undefined || value === '') return DEFAULT_SORT;
        const parsed = parseSort(value);
        if (!parsed || !(DOCUMENT_TYPE_SORT_FIELDS as readonly string[]).includes(parsed.field)) {
          ctx.issues.push({
            code: 'custom',
            message: VALIDATION_MESSAGES.invalidSort,
            input: value,
          });
          return DEFAULT_SORT;
        }
        return parsed;
      }),
    q: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value ? value : undefined)),
    categoryId: facetOfIds,
    active: z.stringbool().optional(),
    requiresSignature: z.stringbool().optional(),
    hasExpiration: z.stringbool().optional(),
  })
  .transform((raw): DocumentTypeListQuery => ({
    page: raw.page,
    pageSize: raw.pageSize,
    sort: raw.sort,
    ...(raw.q !== undefined ? { q: raw.q } : {}),
    ...(raw.categoryId !== undefined ? { categoryId: raw.categoryId } : {}),
    ...(raw.active !== undefined ? { active: raw.active } : {}),
    ...(raw.requiresSignature !== undefined ? { requiresSignature: raw.requiresSignature } : {}),
    ...(raw.hasExpiration !== undefined ? { hasExpiration: raw.hasExpiration } : {}),
  }));
export class ListDocumentTypesQueryDto extends createZodDto(documentTypeListQuerySchema) {}
