import { z } from "./zod";
import { VALIDATION_MESSAGES, idSchema, listQuerySchema, type Paginated } from "./common";
import { techCategorySchema } from "./enums";
import { facetOf, hexColorSchema, optionalText, requiredText, withSortFields } from "./tags";

/**
 * Technology catalog (PRD §8.3 "Stack", managed in Settings → Tecnologías). A project's stack accepts
 * catalog technologies only (ids, never free text). A technology in use cannot be deleted, only
 * deactivated (C19, INTEGRITY_LOCK).
 *
 * `nameEn` is the optional English name (PRD §7.8: catalogs keep `name` in Spanish and `nameEn`); the
 * UI falls back to `name`. DT-72: the schema delta (Δ4) adding `nameEn` to `Technology` is decided; until
 * it lands, and whenever `nameEn` is empty, English display falls back to `name`.
 */

/** `next-js`, `react-native`… */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const technologySlugSchema = z
  .string()
  .max(60, VALIDATION_MESSAGES.invalidFormat)
  .regex(SLUG_PATTERN, VALIDATION_MESSAGES.invalidFormat);

/** Simple Icons slug (`nextdotjs`, `postgresql`): lower-case letters and digits. */
export const iconSlugSchema = z
  .string()
  .max(60, VALIDATION_MESSAGES.invalidFormat)
  .regex(/^[a-z0-9]+$/, VALIDATION_MESSAGES.invalidFormat);

// ───────────────────────────── Inputs ─────────────────────────────

const technologyFieldsShape = {
  name: requiredText(60),
  nameEn: optionalText(60),
  /** Derived from the name by the service when omitted. */
  slug: technologySlugSchema.optional(),
  category: techCategorySchema,
  iconSlug: iconSlugSchema.optional(),
  color: hexColorSchema.optional(),
  active: z.boolean().default(true),
};

/** `createTechnology`. The name and the slug are unique (CONFLICT). */
export const createTechnologyInputSchema = z.object(technologyFieldsShape);
export type CreateTechnologyInput = z.infer<typeof createTechnologyInputSchema>;

/** `updateTechnology`: the edit form submits every editable field. */
export const updateTechnologyInputSchema = z.object({ id: idSchema, ...technologyFieldsShape });
export type UpdateTechnologyInput = z.infer<typeof updateTechnologyInputSchema>;

/** `setTechnologyActive`: the only way to retire a technology that is in use. */
export const setTechnologyActiveInputSchema = z.object({ id: idSchema, active: z.boolean() });
export type SetTechnologyActiveInput = z.infer<typeof setTechnologyActiveInputSchema>;

/** `deleteTechnology`: allowed only when no project uses it (INTEGRITY_LOCK otherwise). */
export const deleteTechnologyInputSchema = z.object({ id: idSchema });
export type DeleteTechnologyInput = z.infer<typeof deleteTechnologyInputSchema>;

export const technologyIdInputSchema = z.object({ id: idSchema });
export type TechnologyIdInput = z.infer<typeof technologyIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const TECHNOLOGY_SORT_FIELDS = ["name", "category", "usageCount", "active"] as const;

export const technologyFilterSchema = withSortFields(
  listQuerySchema.extend({
    category: facetOf(techCategorySchema),
    active: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
  TECHNOLOGY_SORT_FIELDS,
);
export type TechnologyFilter = z.infer<typeof technologyFilterSchema>;
export type TechnologyFilterInput = z.input<typeof technologyFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Compact technology: stack icons in tables and cards, and graph nodes. */
export const technologyChipSchema = z.object({
  id: idSchema,
  name: z.string(),
  nameEn: z.string().nullable(),
  slug: z.string(),
  category: techCategorySchema,
  iconSlug: z.string().nullable(),
  color: z.string().nullable(),
});
export type TechnologyChipDTO = z.infer<typeof technologyChipSchema>;

/** Row of Settings → Tecnologías (also the detail DTO). */
export const technologyListRowSchema = technologyChipSchema.extend({
  active: z.boolean(),
  /** Non-archived projects using it. */
  usageCount: z.number().int().nonnegative(),
});
export type TechnologyListRowDTO = z.infer<typeof technologyListRowSchema>;

export const technologyDetailSchema = technologyListRowSchema;
export type TechnologyDetailDTO = z.infer<typeof technologyDetailSchema>;

// ───────────────────────────── Services ─────────────────────────────

/**
 * Technology catalog services (PRD §12 `settings`: "CRUD de catálogos"). Every service is
 * `fn(ctx, input) → Promise<DTO>` (C9, C11).
 */
export type TechnologiesService<Ctx = unknown> = {
  createTechnology: (ctx: Ctx, input: CreateTechnologyInput) => Promise<TechnologyDetailDTO>;
  updateTechnology: (ctx: Ctx, input: UpdateTechnologyInput) => Promise<TechnologyDetailDTO>;
  setTechnologyActive: (ctx: Ctx, input: SetTechnologyActiveInput) => Promise<TechnologyDetailDTO>;
  deleteTechnology: (ctx: Ctx, input: DeleteTechnologyInput) => Promise<TechnologyIdInput>;
  listTechnologies: (ctx: Ctx, input: TechnologyFilter) => Promise<Paginated<TechnologyListRowDTO>>;
  getTechnology: (ctx: Ctx, input: TechnologyIdInput) => Promise<TechnologyDetailDTO>;
};
