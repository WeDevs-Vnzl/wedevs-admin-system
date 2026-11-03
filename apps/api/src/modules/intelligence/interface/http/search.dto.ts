import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { VALIDATION_MESSAGES, idSchema } from '../../../../shared/interface/common.schemas';
import {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  type SearchResults,
} from '../../application/use-cases/search/search-global.use-case';

const searchableTypeSchema = z.enum(SEARCHABLE_ENTITY_TYPE_VALUES);

/** A single value or repeated keys (`?entityTypes=CLIENT&entityTypes=NOTE`), normalized to an array. */
const entityTypesSchema = z
  .union([searchableTypeSchema, z.array(searchableTypeSchema).min(1).max(9)])
  .optional()
  .transform((value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]))
  .meta({ type: 'array', items: { type: 'string', enum: [...SEARCHABLE_ENTITY_TYPE_VALUES] } });

/**
 * `GET /search` query (shape only; the use case enforces the same limits again, lesson B2). `q` is what the
 * user typed, prefix included.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, VALIDATION_MESSAGES.required).max(200, 'search.validation.q'),
  entityTypes: entityTypesSchema,
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true')
    .meta({ type: 'boolean', default: false }),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'search.validation.limit')
    .max(SEARCH_MAX_LIMIT, 'search.validation.limit')
    .default(SEARCH_DEFAULT_LIMIT)
    .meta({
      type: 'integer',
      minimum: 1,
      maximum: SEARCH_MAX_LIMIT,
      default: SEARCH_DEFAULT_LIMIT,
    }),
});
export class SearchQueryDto extends createZodDto(searchQuerySchema) {}

export const searchResultSchema = z.object({
  entityType: searchableTypeSchema,
  entityId: idSchema,
  code: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** Raw status value of the entity; the UI translates it by `entityType`. */
  status: z.string().nullable(),
  archived: z.boolean(),
});

export const searchGroupSchema = z.object({
  entityType: searchableTypeSchema,
  /** Matches of this type before the cap. */
  total: z.number().int().nonnegative(),
  items: z.array(searchResultSchema),
});

export const searchResultsSchema = z.object({
  /** The text actually searched (prefix removed). */
  query: z.string(),
  /** Type forced by the prefix, if any. */
  entityType: searchableTypeSchema.nullable(),
  groups: z.array(searchGroupSchema),
});
export class SearchResultsDto extends createZodDto(searchResultsSchema) {}

// Output mapping, shared with the MCP tool.
export const toSearchResponse = (result: SearchResults): SearchResultsDto => ({
  query: result.query,
  entityType: result.entityType,
  groups: result.groups.map((group) => ({
    entityType: group.entityType,
    total: group.total,
    items: group.items.map((item) => ({ ...item })),
  })),
});
