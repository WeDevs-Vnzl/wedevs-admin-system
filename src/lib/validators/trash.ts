import { z } from "./zod";
import {
  entityRefSchema,
  idSchema,
  listQuerySchema,
  dateOnlySchema,
  type Paginated,
} from "./common";
import { entityTypeSchema } from "./enums";
import { facetOf, timestampSchema, withSortFields } from "./tags";
import { userRefSchema } from "./users";

/**
 * Trash and soft delete (PRD §7.7; C19). Main entities are archived (`deletedAt`/`deletedById`), never
 * hard-deleted; Settings → Papelera lists the archived rows and restores them (Owner/Admin). There is no
 * purge in the MVP. Integrity locks live in each module's archive service (INTEGRITY_LOCK).
 */

/** Entity types that appear in the trash (soft-deletable main entities, data-rules §6). */
export const TRASHABLE_ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "RECURRING_EXPENSE",
  "ACCOUNT",
  "TRANSFER",
  "ACCOUNT_MOVEMENT",
  "DOCUMENT",
  "NOTE",
] as const satisfies readonly z.infer<typeof entityTypeSchema>[];
export const trashableEntityTypeSchema = z.enum(TRASHABLE_ENTITY_TYPE_VALUES);
export type TrashableEntityType = z.infer<typeof trashableEntityTypeSchema>;

// ───────────────────────────── Shared archive result ─────────────────────────────

/** Output of every `archiveX` service: the record is hidden from default reads from `archivedAt` on. */
export const archivedRecordSchema = z.object({
  id: idSchema,
  archivedAt: timestampSchema,
});
export type ArchivedRecordDTO = z.infer<typeof archivedRecordSchema>;

// ───────────────────────────── Inputs ─────────────────────────────

/** `restoreFromTrash`: clears `deletedAt`. Returns CONFLICT when a unique rule now collides. */
export const restoreFromTrashInputSchema = z.object({
  entityType: trashableEntityTypeSchema,
  entityId: idSchema,
});
export type RestoreFromTrashInput = z.infer<typeof restoreFromTrashInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const TRASH_SORT_FIELDS = ["deletedAt", "entityType", "label"] as const;

export const trashFilterSchema = withSortFields(
  listQuerySchema.extend({
    entityType: facetOf(trashableEntityTypeSchema),
    deletedById: facetOf(idSchema),
    deletedFrom: dateOnlySchema.optional(),
    deletedTo: dateOnlySchema.optional(),
  }),
  TRASH_SORT_FIELDS,
);
export type TrashFilter = z.infer<typeof trashFilterSchema>;
export type TrashFilterInput = z.input<typeof trashFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Row of the trash table. */
export const trashRowSchema = z.object({
  /** `{ id, code?, label, type }` of the archived record. */
  entity: entityRefSchema.extend({ type: trashableEntityTypeSchema }),
  /** Free context shown under the label (client name of a contact, project of an invoice…). */
  context: z.string().nullable(),
  deletedAt: timestampSchema,
  deletedBy: userRefSchema.nullable(),
});
export type TrashRowDTO = z.infer<typeof trashRowSchema>;

/** Output of `restoreFromTrash`. */
export const restoredRecordSchema = z.object({
  entity: entityRefSchema.extend({ type: trashableEntityTypeSchema }),
  restoredAt: timestampSchema,
});
export type RestoredRecordDTO = z.infer<typeof restoredRecordSchema>;

// ───────────────────────────── Services ─────────────────────────────

/**
 * Trash services (Owner/Admin; PRD §12 does not list them). Every service is `fn(ctx, input) →
 * Promise<DTO>` (C9, C11).
 */
export type TrashService<Ctx = unknown> = {
  listTrash: (ctx: Ctx, input: TrashFilter) => Promise<Paginated<TrashRowDTO>>;
  restoreFromTrash: (ctx: Ctx, input: RestoreFromTrashInput) => Promise<RestoredRecordDTO>;
};
