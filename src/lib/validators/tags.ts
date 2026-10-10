import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  idSchema,
  listQuerySchema,
  parseSort,
  type Paginated,
} from "./common";

/**
 * Tag contracts (PRD §7.5) and the small shared primitives of the commercial/knowledge contracts.
 *
 * Tags are global (name + colour) and can be assigned to clients, contacts, projects, invoices, payments,
 * expenses, documents and notes. They are managed from Settings and created inline.
 *
 * `common.ts` is read-only in wave 3, so the list/form primitives every 3.1 module needs live in the
 * "Shared primitives" section below (timestamps, optional text/email/phone-free helpers, http(s) URLs,
 * hex colours, multi-value facets, sort whitelist). They are candidates for promotion to `common.ts`.
 */

// ───────────────────────────── Shared primitives ─────────────────────────────

/** ISO 8601 UTC timestamp (`2026-10-09T14:30:00.000Z`), as every DTO timestamp. */
export const timestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof timestampSchema>;

/** Optional free text from a form: trimmed, bounded, and `""` becomes `undefined`. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));
}

/** Required free text: trimmed, non-empty, bounded. */
export function requiredText(max: number) {
  return z.string().trim().min(1).max(max);
}

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

/** `#RRGGBB` colour (tags, technologies, categories). */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, VALIDATION_MESSAGES.invalidFormat);

/** A list of ids with no repeats. */
export function uniqueIds(options: { min?: number; max?: number } = {}) {
  let schema = z.array(idSchema);
  if (options.min !== undefined) schema = schema.min(options.min);
  if (options.max !== undefined) schema = schema.max(options.max);
  return schema.refine((ids) => new Set(ids).size === ids.length, {
    message: VALIDATION_MESSAGES.invalidOption,
  });
}

/**
 * Multi-value table facet. URL state delivers a single string or a list; both normalize to a list (or
 * `undefined` when the facet is not set): `status=ACTIVO` and `status=ACTIVO&status=PROSPECTO`.
 */
export function facetOf<T extends z.ZodType>(item: T) {
  return z
    .union([item, z.array(item)])
    .optional()
    .transform((value): z.output<T>[] | undefined =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    );
}

/** `true` when the query's `sort` is absent or sorts by one of `fields`. */
export function sortsBy(sort: string | undefined, fields: readonly string[]): boolean {
  const parsed = parseSort(sort);
  return sort === undefined || (parsed !== null && fields.includes(parsed.field));
}

/** Adds the sort whitelist (`fields`) to a list-query-shaped schema's `sort`. */
export function withSortFields<T extends z.ZodType<{ sort?: string | undefined }>>(
  schema: T,
  fields: readonly string[],
): T {
  return schema.refine((query) => sortsBy(query.sort, fields), {
    message: VALIDATION_MESSAGES.invalidSort,
    path: ["sort"],
  }) as unknown as T;
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
