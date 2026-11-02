import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { parseSort } from '../../../../../shared/domain/list-query';
import { VALIDATION_MESSAGES } from '../../../../../shared/interface/common.schemas';
import {
  EXPORT_ENTITY_VALUES,
  EXPORT_LABEL_MAX,
  EXPORT_MAX_COLUMNS,
} from '../../../application/use-cases/exports/export-csv.use-case';

/** `{entity}` of `POST /exports/{entity}`: the eleven tables of DT-171, in upper case. */
export const exportParamsSchema = z.object({ entity: z.enum(EXPORT_ENTITY_VALUES) });
export class ExportParamsDto extends createZodDto(exportParamsSchema) {}

const filterValueSchema = z.union([z.string().max(200), z.array(z.string().max(200)).max(100)]);

/** The table's list query without paging; the source's list use case validates the filters and the sort field. */
export const exportQuerySchema = z.object({
  q: z.string().max(200).optional(),
  sort: z
    .string()
    .max(100)
    .refine((value) => parseSort(value) !== null, { message: VALIDATION_MESSAGES.invalidSort })
    .optional(),
  archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
  filters: z.record(z.string().max(64), filterValueSchema).default({}),
});

/** A column to write: the source's column id and the header the user sees, already translated. */
export const exportColumnSchema = z.object({
  id: z
    .string()
    .min(1, VALIDATION_MESSAGES.required)
    .max(100)
    .regex(/^[A-Za-z][A-Za-z0-9_.]*$/, VALIDATION_MESSAGES.invalidFormat),
  label: z.string().min(1, VALIDATION_MESSAGES.required).max(EXPORT_LABEL_MAX),
});

/** Shape only; `ExportCsv` checks the ids against the source's whitelist and the repeats again. */
export const exportBodySchema = z.object({
  query: exportQuerySchema.default({ archived: 'exclude', filters: {} }),
  columns: z.array(exportColumnSchema).min(1).max(EXPORT_MAX_COLUMNS),
});
export class ExportBodyDto extends createZodDto(exportBodySchema) {}
