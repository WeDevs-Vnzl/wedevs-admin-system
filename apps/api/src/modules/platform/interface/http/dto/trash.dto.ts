import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  dateOnlySchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import {
  TRASHABLE_ENTITY_TYPE_VALUES,
  type TrashableEntityType,
} from '../../../application/ports/restore-handler.port';
import { TRASH_SORT_FIELDS } from '../../../application/ports/trash-read.port';

export const trashableEntityTypeSchema = z.enum(TRASHABLE_ENTITY_TYPE_VALUES);

export class ListTrashQueryDto extends createListQueryDto({
  sortFields: TRASH_SORT_FIELDS,
  defaultSort: { field: 'deletedAt', direction: 'desc' },
  filters: {
    entityType: trashableEntityTypeSchema,
    deletedById: idSchema,
    deletedFrom: dateOnlySchema,
    deletedTo: dateOnlySchema,
  },
}) {}

/** `{ id, code?, label, type }` of the archived record. */
export const trashEntityRefSchema = z.object({
  id: z.string(),
  code: z.string().optional(),
  label: z.string(),
  type: trashableEntityTypeSchema,
});

export const trashRowSchema = z.object({
  entity: trashEntityRefSchema,
  context: z.string().nullable(),
  deletedAt: timestampSchema,
  deletedBy: z
    .object({ id: z.string(), name: z.string(), imageUrl: z.string().nullable() })
    .nullable(),
});

export const trashListResponseSchema = z.object({
  items: z.array(trashRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class TrashListResponseDto extends createZodDto(trashListResponseSchema) {}

export const restoreFromTrashSchema = z.object({
  entityType: trashableEntityTypeSchema,
  entityId: idSchema,
});
export class RestoreFromTrashDto extends createZodDto(restoreFromTrashSchema) {}

export const restoredRecordSchema = z.object({
  entity: trashEntityRefSchema,
  restoredAt: timestampSchema,
});
export class RestoredRecordResponseDto extends createZodDto(restoredRecordSchema) {}

export type { TrashableEntityType };
