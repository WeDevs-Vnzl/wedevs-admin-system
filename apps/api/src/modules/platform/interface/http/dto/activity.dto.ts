import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ACTIVITY_ACTION_VALUES,
  ACTOR_TYPE_VALUES,
  ENTITY_TYPE_VALUES,
} from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';

export const ACTIVITY_SORT_FIELDS = ['createdAt', 'action', 'entityType'] as const;

/**
 * `GET /activity` query (PRD §8.14). Repeated keys are facets (`?action=CREATE&action=UPDATE`); `entityId`
 * needs exactly one `entityType` and `from`/`to` are Caracas days, both inclusive. Those cross-field rules
 * are applied by the use case (`ValidationFailed` with `fieldErrors`).
 */
export class ListActivityQueryDto extends createListQueryDto({
  sortFields: ACTIVITY_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    actorId: idSchema,
    actorType: z.enum(ACTOR_TYPE_VALUES),
    action: z.enum(ACTIVITY_ACTION_VALUES),
    entityType: z.enum(ENTITY_TYPE_VALUES),
    entityId: idSchema,
    from: dateOnlySchema,
    to: dateOnlySchema,
  },
}) {}

const changeValueSchema = z.union([z.string(), z.boolean(), z.null()]);

/** A stored `changes` entry: `[before, after]`, or the `"changed"` marker of a long text (C20). */
const activityChangeSchema = z.union([
  z.tuple([changeValueSchema, changeValueSchema]),
  z.literal('changed'),
]);

export const activityRowSchema = z.object({
  id: z.string(),
  actor: z.object({
    type: z.enum(ACTOR_TYPE_VALUES),
    id: z.string().nullable(),
    name: z.string().nullable(),
    imageUrl: z.string().nullable(),
  }),
  action: z.enum(ACTIVITY_ACTION_VALUES),
  entityType: z.enum(ENTITY_TYPE_VALUES),
  entityId: z.string(),
  /** Snapshot of the entity's label when the event happened. */
  entityLabel: z.string(),
  /** Field keys are stable; the labels are the FE's i18n (DT-114). */
  changes: z.record(z.string(), activityChangeSchema).nullable(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .nullable(),
  /** Masked: `192.0.2.•••`, IPv6 after the third group, `•••` otherwise (DT-114). */
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: timestampSchema,
});
export type ActivityRowDto = z.infer<typeof activityRowSchema>;

export const activityListResponseSchema = z.object({
  items: z.array(activityRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class ActivityListResponseDto extends createZodDto(activityListResponseSchema) {}
