import { z } from "./zod";
import { entityRefSchema, idSchema, listQuerySchema, dateOnlySchema } from "./common";
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
/**
 * The types the trash offers as facets: the contexts that register a restore handler in the BE (platform
 * trash module). Other trashable types exist in the schema but are not listed.
 */
export const RESTORABLE_ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "NOTE",
  "INVOICE",
  "DOCUMENT",
] as const satisfies readonly (typeof TRASHABLE_ENTITY_TYPE_VALUES)[number][];
export const trashableEntityTypeSchema = z.enum(TRASHABLE_ENTITY_TYPE_VALUES);

// ───────────────────────────── Shared archive result ─────────────────────────────

/** Output of every `archiveX` service: the record is hidden from default reads from `archivedAt` on. */
export const archivedRecordSchema = z.object({
  id: idSchema,
  archivedAt: timestampSchema,
});
export type ArchivedRecordDTO = z.infer<typeof archivedRecordSchema>;

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
