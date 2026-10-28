import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { TECH_CATEGORY_VALUES } from '../../../../../shared/domain/enums';
import { idSchema } from '../../../../../shared/interface/common.schemas';
import {
  createListQueryDto,
  createListQuerySchema,
} from '../../../../../shared/interface/list-query.dto';

/**
 * Request and response shapes of `/technologies` (the FE `technologies` validators, shape and length
 * only). Trimming, the slug, icon and colour patterns, the uniqueness and the usage lock are domain rules
 * answered as `VALIDATION` / `CONFLICT` / `INTEGRITY_LOCK`.
 */

const categorySchema = z.enum(TECH_CATEGORY_VALUES);

export const technologyInputDtoSchema = z.object({
  name: z.string().max(60),
  nameEn: z.string().max(60).nullish(),
  slug: z.string().max(60).nullish(),
  category: categorySchema,
  iconSlug: z.string().max(60).nullish(),
  color: z.string().max(7).nullish(),
  active: z.boolean().default(true),
});

export const createTechnologyDtoSchema = technologyInputDtoSchema;
export const updateTechnologyDtoSchema = technologyInputDtoSchema;
export class CreateTechnologyDto extends createZodDto(createTechnologyDtoSchema) {}
export class UpdateTechnologyDto extends createZodDto(updateTechnologyDtoSchema) {}

export const setTechnologyActiveDtoSchema = z.object({ active: z.boolean() });
export class SetTechnologyActiveDto extends createZodDto(setTechnologyActiveDtoSchema) {}

export const technologyIdParamsSchema = z.object({ id: idSchema });
export class TechnologyIdParamsDto extends createZodDto(technologyIdParamsSchema) {}

/** Sortable fields of the catalog: the whitelist of `sort` (HU-06 CA2). */
export const TECHNOLOGY_SORT_FIELDS = ['name', 'category', 'usageCount', 'active'] as const;

const technologyListOptions = {
  sortFields: TECHNOLOGY_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: {
    category: categorySchema,
    active: z.enum(['true', 'false']),
  },
} as const;

/** `GET /technologies` query: paging, `q`, `sort` and the `category` / `active` facets. */
export const technologyListQuerySchema = createListQuerySchema(technologyListOptions);
export class ListTechnologiesQueryDto extends createListQueryDto(technologyListOptions) {}

export const technologyViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  slug: z.string(),
  category: categorySchema,
  iconSlug: z.string().nullable(),
  color: z.string().nullable(),
  active: z.boolean(),
  /** Live (non-archived) projects that list the technology. */
  usageCount: z.number().int().nonnegative(),
});
export class TechnologyViewDto extends createZodDto(technologyViewSchema) {}

export const technologyListResponseSchema = z.object({
  items: z.array(technologyViewSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class TechnologyListResponseDto extends createZodDto(technologyListResponseSchema) {}

export const technologyDeletedSchema = z.object({ id: z.string() });
export class TechnologyDeletedDto extends createZodDto(technologyDeletedSchema) {}
