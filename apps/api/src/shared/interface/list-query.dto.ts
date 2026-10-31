import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_VALUES,
  parseSort,
  type ListFilters,
  type ListQuery,
  type SortSpec,
} from '../domain';
import { VALIDATION_MESSAGES } from './common.schemas';

export interface ListQuerySchemaOptions<F extends Readonly<Record<string, z.ZodType<string>>>> {
  /** Fields the resource may be sorted by. */
  readonly sortFields: readonly string[];
  /** Sort applied when the request carries none. */
  readonly defaultSort: SortSpec;
  /** Flat resource filters: name -> schema of one value; repeated keys become arrays. */
  readonly filters?: F;
}

/** A single value or repeated query keys (`?status=A&status=B`). */
function multi(item: z.ZodType<string>) {
  return z.union([item, z.array(item)]).optional();
}

/**
 * Builds the query schema of a list endpoint (`api-contract.md` §3). The output is the framework-free
 * `shared/domain` `ListQuery`: `page`, `pageSize`, `sort` (whitelisted, defaulted), `q`, `archived`
 * and the resource `filters`. A sort outside the whitelist is `validation.sort.invalid` on `sort`.
 */
export function createListQuerySchema<
  F extends Readonly<Record<string, z.ZodType<string>>> = Record<never, never>,
>(options: ListQuerySchemaOptions<F>) {
  const filterSchemas = options.filters ?? ({} as F);
  const filterShape = Object.fromEntries(
    Object.entries(filterSchemas).map(([name, item]) => [name, multi(item)]),
  );
  const filterNames = Object.keys(filterShape);
  const sortTokens = options.sortFields.flatMap((field) => [`${field}:asc`, `${field}:desc`]);

  return z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce
        .number()
        .pipe(z.union([z.literal(25), z.literal(50), z.literal(100)]))
        // The pipe's JSON Schema is its input side (`number`); the meta restores the real contract (m3).
        .meta({ type: 'integer', enum: [...PAGE_SIZE_VALUES] })
        .default(DEFAULT_PAGE_SIZE),
      sort: z
        .string()
        .optional()
        .meta({ enum: sortTokens })
        .transform((value, ctx): SortSpec => {
          if (value === undefined || value === '') return options.defaultSort;
          const parsed = parseSort(value);
          if (!parsed || !options.sortFields.includes(parsed.field)) {
            ctx.issues.push({
              code: 'custom',
              message: VALIDATION_MESSAGES.invalidSort,
              input: value,
            });
            return options.defaultSort;
          }
          return parsed;
        }),
      q: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => (value ? value : undefined)),
      archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
      ...filterShape,
    })
    .transform((raw): ListQuery => {
      const record = raw as Record<string, unknown>;
      const filters: Record<string, string | readonly string[]> = {};
      for (const name of filterNames) {
        const value = record[name] as string | readonly string[] | undefined;
        if (value !== undefined) filters[name] = value;
      }
      const query: ListQuery = {
        page: raw.page,
        pageSize: raw.pageSize,
        sort: raw.sort,
        archived: raw.archived,
        filters: filters satisfies ListFilters,
        ...(raw.q !== undefined ? { q: raw.q } : {}),
      };
      return query;
    });
}

/** nestjs-zod DTO for `@Query()`, so the params appear in OpenAPI. */
export function createListQueryDto<
  F extends Readonly<Record<string, z.ZodType<string>>> = Record<never, never>,
>(options: ListQuerySchemaOptions<F>) {
  return createZodDto(createListQuerySchema(options));
}
