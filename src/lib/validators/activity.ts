import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  dateOnlySchema,
  idSchema,
  listQuerySchema,
  type Paginated,
} from "./common";
import { activityActionSchema, actorTypeSchema, entityTypeSchema } from "./enums";
import { facetOf, timestampSchema, withSortFields } from "./tags";

/**
 * Activity log (PRD §8.14; C12, C20). Complete and immutable: **append-only**, with no update or delete
 * service. Entries are written only by services through `logActivity`, inside the mutation's transaction
 * (never through a `can()` grant; `activity` grants only `read` to Owner/Admin — DT-66).
 *
 * `changes` is a per-field diff `{ field: [before, after] }`. Sensitive fields (and long texts, for
 * which only "it changed" is recorded) are excluded. Values are strings, booleans or `null`: money,
 * rates and numbers are serialized as strings (C15), so a diff never carries a JS number for money.
 */

// ───────────────────────────── Diff ─────────────────────────────

/** Marker for a long text whose content is not recorded: only that it changed. */
export const ACTIVITY_CHANGED_MARKER = "changed" as const;

export const activityDiffValueSchema = z.union([z.string(), z.boolean(), z.null()]);
export type ActivityDiffValue = z.infer<typeof activityDiffValueSchema>;

/** `[before, after]`, or the `"changed"` marker for long or sensitive-adjacent text. */
export const activityChangeSchema = z.union([
  z.tuple([activityDiffValueSchema, activityDiffValueSchema]),
  z.literal(ACTIVITY_CHANGED_MARKER),
]);
export type ActivityChange = z.infer<typeof activityChangeSchema>;

export const activityChangesSchema = z.record(z.string().min(1).max(64), activityChangeSchema);
export type ActivityChanges = z.infer<typeof activityChangesSchema>;

export const activityMetadataSchema = z.record(
  z.string().min(1).max(64),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export type ActivityMetadata = z.infer<typeof activityMetadataSchema>;

// ───────────────────────────── logActivity (internal) ─────────────────────────────

/**
 * Input of `logActivity(tx, input)`: internal, called by services inside their transaction. Never wired
 * to a Server Action. `USER` events carry the actor id; `SYSTEM` (jobs) and `PUBLIC` (portal visitors)
 * carry none.
 */
export const logActivityInputSchema = z
  .object({
    actorType: actorTypeSchema,
    actorId: idSchema.nullable().default(null),
    action: activityActionSchema,
    entityType: entityTypeSchema,
    entityId: idSchema,
    /** Label of the entity at that moment (snapshot, so history survives renames). */
    entityLabel: z.string().min(1).max(200),
    changes: activityChangesSchema.optional(),
    metadata: activityMetadataSchema.optional(),
    /** Raw request data for user actions; the log keeps what PRD §8.14 requires. */
    ip: z.string().max(64).optional(),
    userAgent: z.string().max(512).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.actorType === "USER" && entry.actorId === null) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: ["actorId"] });
    }
    if (entry.actorType !== "USER" && entry.actorId !== null) {
      ctx.addIssue({
        code: "custom",
        message: VALIDATION_MESSAGES.invalidOption,
        path: ["actorId"],
      });
    }
  });
export type LogActivityInput = z.infer<typeof logActivityInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const ACTIVITY_SORT_FIELDS = ["createdAt", "action", "entityType"] as const;

/**
 * `/activity` (global) and the "Actividad" tab of any record: set `entityType` + `entityId` (both or
 * neither) for the record's timeline.
 */
export const activityFilterSchema = withSortFields(
  listQuerySchema
    .extend({
      actorId: facetOf(idSchema),
      actorType: facetOf(actorTypeSchema),
      action: facetOf(activityActionSchema),
      entityType: facetOf(entityTypeSchema),
      entityId: idSchema.optional(),
      from: dateOnlySchema.optional(),
      to: dateOnlySchema.optional(),
    })
    .refine((query) => query.entityId === undefined || query.entityType?.length === 1, {
      message: VALIDATION_MESSAGES.required,
      path: ["entityType"],
    })
    .refine((query) => !query.from || !query.to || query.from <= query.to, {
      message: VALIDATION_MESSAGES.invalidDate,
      path: ["to"],
    }),
  ACTIVITY_SORT_FIELDS,
);
export type ActivityFilter = z.infer<typeof activityFilterSchema>;
export type ActivityFilterInput = z.input<typeof activityFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Who acted. `SYSTEM` and `PUBLIC` have no user: the UI shows a localized label. */
export const activityActorSchema = z.object({
  type: actorTypeSchema,
  id: idSchema.nullable(),
  name: z.string().nullable(),
  imageUrl: z.string().nullable(),
});
export type ActivityActorDTO = z.infer<typeof activityActorSchema>;

export const activityEntrySchema = z.object({
  id: idSchema,
  actor: activityActorSchema,
  action: activityActionSchema,
  entityType: entityTypeSchema,
  entityId: idSchema,
  /** Snapshot of the entity's label when the event happened. */
  entityLabel: z.string(),
  changes: activityChangesSchema.nullable(),
  metadata: activityMetadataSchema.nullable(),
  /** User actions only. */
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: timestampSchema,
});
export type ActivityEntryDTO = z.infer<typeof activityEntrySchema>;

/** Row of the activity table / timeline item; the entry itself. */
export const activityListRowSchema = activityEntrySchema;
export type ActivityListRowDTO = z.infer<typeof activityListRowSchema>;

// ───────────────────────────── Services (PRD §12 `activity`) ─────────────────────────────

/**
 * Activity services. Every service is `fn(ctx, input)`. `listActivity` is the only one reachable from
 * the UI (Owner/Admin); `logActivity` is internal and returns nothing the UI uses. There is no update or
 * delete (C20). CSV export of the log goes through the `export` module (`exportCsv`).
 */
export type ActivityService<Ctx = unknown> = {
  logActivity: (ctx: Ctx, input: LogActivityInput) => Promise<ActivityEntryDTO>;
  listActivity: (ctx: Ctx, input: ActivityFilter) => Promise<Paginated<ActivityListRowDTO>>;
};
