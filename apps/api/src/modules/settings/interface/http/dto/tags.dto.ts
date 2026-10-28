import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  VALIDATION_MESSAGES,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';

/**
 * The wire bounds repeat the domain's (`TAGGABLE_ENTITY_TYPE_VALUES`, `TAG_NAME_MAX_LENGTH`,
 * `TAG_COLOR_PATTERN`): an interface file may not import the domain. `tags.dto.test.ts` pins them equal.
 */
export const TAGGABLE_ENTITY_TYPES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'DOCUMENT',
  'NOTE',
] as const;
export const TAG_NAME_MAX = 40;
export const TAG_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const taggableEntityTypeSchema = z.enum(TAGGABLE_ENTITY_TYPES);

/** Shape and length only; trimming and the rest are domain rules (`normalizeTagName`). */
const tagNameSchema = z.string().trim().min(1, VALIDATION_MESSAGES.required).max(TAG_NAME_MAX);
const tagColorSchema = z.string().regex(TAG_COLOR_REGEX, VALIDATION_MESSAGES.invalidFormat);

export const TAG_SORT_FIELDS = ['name', 'usageCount', 'createdAt'] as const;

/** `GET /tags`: `entityType` keeps the tags assigned to at least one live record of those types. */
export class ListTagsQueryDto extends createListQueryDto({
  sortFields: TAG_SORT_FIELDS,
  defaultSort: { field: 'name', direction: 'asc' },
  filters: { entityType: taggableEntityTypeSchema },
}) {}

export const createTagSchema = z.object({ name: tagNameSchema, color: tagColorSchema });
export class CreateTagDto extends createZodDto(createTagSchema) {}

export const updateTagSchema = z.object({
  name: tagNameSchema.optional(),
  color: tagColorSchema.optional(),
});
export class UpdateTagDto extends createZodDto(updateTagSchema) {}

/** Up to 50 distinct tag ids (FE `uniqueIds({ min: 1, max: 50 })`). */
const tagIdsSchema = z
  .array(idSchema)
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: VALIDATION_MESSAGES.invalidOption,
  });

export const assignTagsSchema = z.object({
  entityType: taggableEntityTypeSchema,
  entityId: idSchema,
  tagIds: tagIdsSchema,
});
export class AssignTagsDto extends createZodDto(assignTagsSchema) {}

export const unassignTagSchema = z.object({
  entityType: taggableEntityTypeSchema,
  entityId: idSchema,
  tagId: idSchema,
});
export class UnassignTagDto extends createZodDto(unassignTagSchema) {}

export const tagChipSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });

/** Tag row and detail: chip + non-archived usage. */
export const tagSchema = tagChipSchema.extend({
  usageCount: z.number().int().nonnegative(),
  createdAt: timestampSchema,
});
export class TagDto extends createZodDto(tagSchema) {}

export const tagListResponseSchema = z.object({
  items: z.array(tagSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class TagListResponseDto extends createZodDto(tagListResponseSchema) {}

/** The record's tags after `assign` / `unassign`, in chip order. */
export const tagChipsResponseSchema = z.object({ items: z.array(tagChipSchema) });
export class TagChipsResponseDto extends createZodDto(tagChipsResponseSchema) {}
