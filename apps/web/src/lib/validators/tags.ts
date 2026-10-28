import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  facetOf,
  hexColorSchema,
  idSchema,
  listQuerySchema,
  requiredText,
  timestampSchema,
  withSortFields,
  type Paginated,
} from "./common";

// Shared helpers live in `common.ts` (one behaviour each); re-exported under their historical names.
export {
  facetOf,
  hexColorSchema,
  optionalText,
  requiredText,
  sortsBy,
  timestampSchema,
  withSortFields,
  type Timestamp,
} from "./common";

/**
 * Tag contracts (PRD §7.5) and the small shared primitives of the commercial/knowledge contracts.
 *
 * Tags are global (name + colour) and can be assigned to clients, contacts, projects, invoices, payments,
 * expenses, documents and notes. They are managed from Settings and created inline.
 *
 * The text, timestamp, colour, facet and sort-whitelist helpers moved to `common.ts` and are re-exported
 * from here; the e-mail, http(s) URL and unique-id helpers remain in the "Shared primitives" section.
 */

// ───────────────────────────── Shared primitives ─────────────────────────────

const EMAIL_PATTERN = z.email();

/** Optional e-mail from a form (`""` → `undefined`). */
export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === "" || EMAIL_PATTERN.safeParse(value).success, {
    message: VALIDATION_MESSAGES.invalidEmail,
  })
  .optional()
  .transform((value) => (value ? value : undefined));

/** `http:` / `https:` URL with a host. Rejects `javascript:`, `data:`, `file:` and friends (C4). */
export function isHttpUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

export const httpUrlSchema = z
  .string()
  .trim()
  .refine(isHttpUrl, { message: VALIDATION_MESSAGES.invalidFormat });

/** Optional `http(s)` URL from a form (`""` → `undefined`). */
export const optionalHttpUrlSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isHttpUrl(value), {
    message: VALIDATION_MESSAGES.invalidFormat,
  })
  .optional()
  .transform((value) => (value ? value : undefined));

/** A list of ids with no repeats. */
export function uniqueIds(options: { min?: number; max?: number } = {}) {
  let schema = z.array(idSchema);
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);
  return schema.refine((ids) => new Set(ids).size === ids.length, {
    message: VALIDATION_MESSAGES.invalidOption,
  });
}

/** Row selected in a bulk action (PRD §7.3): at least one, no repeats, bounded. */
export const bulkIdsSchema = uniqueIds({ min: 1, max: 500 });

// ───────────────────────────── Taggable entities ─────────────────────────────

/** Entities a tag can be assigned to (PRD §7.5). */
export const TAGGABLE_ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "DOCUMENT",
  "NOTE",
] as const;
export const taggableEntityTypeSchema = z.enum(TAGGABLE_ENTITY_TYPE_VALUES);
export type TaggableEntityType = z.infer<typeof taggableEntityTypeSchema>;

// ───────────────────────────── Inputs ─────────────────────────────

export const tagNameSchema = requiredText(40);

const tagFieldsShape = {
  name: tagNameSchema,
  color: hexColorSchema,
};

/** `createTag` (Settings → Etiquetas and inline creation). The name is unique (case-insensitive: CONFLICT). */
export const createTagInputSchema = z.object(tagFieldsShape);
export type CreateTagInput = z.infer<typeof createTagInputSchema>;

/** `updateTag`: rename and/or recolour. */
export const updateTagInputSchema = z.object({
  id: idSchema,
  name: tagNameSchema.optional(),
  color: hexColorSchema.optional(),
});
export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;

/** `assignTags`: adds tags to one entity (already assigned tags are ignored). Returns the entity's tags. */
export const assignTagsInputSchema = z.object({
  entityType: taggableEntityTypeSchema,
  entityId: idSchema,
  tagIds: uniqueIds({ min: 1, max: 50 }),
});
export type AssignTagsInput = z.infer<typeof assignTagsInputSchema>;

/** `unassignTag`: removes one tag from one entity. */
export const unassignTagInputSchema = z.object({
  entityType: taggableEntityTypeSchema,
  entityId: idSchema,
  tagId: idSchema,
});
export type UnassignTagInput = z.infer<typeof unassignTagInputSchema>;

export const tagIdInputSchema = z.object({ id: idSchema });
export type TagIdInput = z.infer<typeof tagIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const TAG_SORT_FIELDS = ["name", "usageCount", "createdAt"] as const;

export const tagFilterSchema = withSortFields(
  listQuerySchema.extend({
    /** Only tags assigned to at least one record of these entity types. */
    entityType: facetOf(taggableEntityTypeSchema),
  }),
  TAG_SORT_FIELDS,
);
export type TagFilter = z.infer<typeof tagFilterSchema>;
export type TagFilterInput = z.input<typeof tagFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Compact tag, as shown in the chips of tables, cards and the graph. */
export const tagChipSchema = z.object({
  id: idSchema,
  name: z.string(),
  color: hexColorSchema,
});
export type TagChipDTO = z.infer<typeof tagChipSchema>;

/** Row of the Settings → Etiquetas table. */
export const tagListRowSchema = tagChipSchema.extend({
  /** Records the tag is assigned to (non-archived). */
  usageCount: z.number().int().nonnegative(),
  createdAt: timestampSchema,
});
export type TagListRowDTO = z.infer<typeof tagListRowSchema>;

export const tagDetailSchema = tagListRowSchema;
export type TagDetailDTO = z.infer<typeof tagDetailSchema>;

// ───────────────────────────── Services (PRD §12 `tags`) ─────────────────────────────

/**
 * `tags` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11); `Ctx` is the service
 * context `{ db, user, now }` built by `server/context.ts`. Failures (CONFLICT, NOT_FOUND…) are reported
 * to the action adapter, never returned as DTOs. `listTags` / `getTag` are the read counterparts that
 * PRD §12 ("servicios principales") leaves implicit.
 */
export type TagsService<Ctx = unknown> = {
  createTag: (ctx: Ctx, input: CreateTagInput) => Promise<TagDetailDTO>;
  updateTag: (ctx: Ctx, input: UpdateTagInput) => Promise<TagDetailDTO>;
  assignTags: (ctx: Ctx, input: AssignTagsInput) => Promise<TagChipDTO[]>;
  unassignTag: (ctx: Ctx, input: UnassignTagInput) => Promise<TagChipDTO[]>;
  listTags: (ctx: Ctx, input: TagFilter) => Promise<Paginated<TagListRowDTO>>;
  getTag: (ctx: Ctx, input: TagIdInput) => Promise<TagDetailDTO>;
};
