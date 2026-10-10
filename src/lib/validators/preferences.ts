import { z } from "./zod";
import { VALIDATION_MESSAGES } from "./common";

/**
 * Per-user preferences (PRD §7.3, §7.8, §8.15; DT-43). Stored as `UserPreference` rows
 * `{ userId, key, value: Json }`; the allowed keys are:
 *
 * - `locale`   — `"es" | "en"`
 * - `theme`    — `"light" | "dark" | "system"`
 * - `timezone` — IANA zone, display only (default `America/Caracas`, DT-43)
 * - `table:<tableId>:columns` — visibility, order and width of a table's columns
 */

// ───────────────────────────── Values ─────────────────────────────

export const LOCALE_VALUES = ["es", "en"] as const;
export const localeSchema = z.enum(LOCALE_VALUES);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = "es";

export const THEME_VALUES = ["light", "dark", "system"] as const;
export const themeSchema = z.enum(THEME_VALUES);
export type Theme = z.infer<typeof themeSchema>;
export const DEFAULT_THEME: Theme = "system";

/** Business time zone; also the default display zone of every user. */
export const DEFAULT_TIMEZONE = "America/Caracas";

/** A real IANA time zone (`America/Caracas`, `UTC`…), checked with `Intl`. */
export function isValidTimezone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .refine(isValidTimezone, { message: VALIDATION_MESSAGES.invalidOption });
export type Timezone = z.infer<typeof timezoneSchema>;

// ───────────────────────────── Table columns ─────────────────────────────

/** Stable id of a table (`clients`, `invoices`, `project-links`…): lower-case kebab. */
export const tableIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, VALIDATION_MESSAGES.invalidFormat)
  .max(40, VALIDATION_MESSAGES.invalidFormat);
export type TableId = z.infer<typeof tableIdSchema>;

/** `UserPreference.key` of a table's column configuration. */
export function tableColumnsKey(tableId: string): string {
  return `table:${tableId}:columns`;
}

/** The `UserPreference.key` for a table: `table:<tableId>:columns`. */
export const tableColumnsKeySchema = z
  .string()
  .regex(/^table:[a-z][a-z0-9]*(?:-[a-z0-9]+)*:columns$/, VALIDATION_MESSAGES.invalidFormat)
  .max(54, VALIDATION_MESSAGES.invalidFormat);

/** Extracts `<tableId>` from a `table:<tableId>:columns` key; `null` when it is not one. */
export function parseTableColumnsKey(key: string): string | null {
  const match = /^table:(.+):columns$/.exec(key);
  const tableId = match?.[1];
  return tableId !== undefined && tableIdSchema.safeParse(tableId).success ? tableId : null;
}

/** Column id as the data table declares it (`tradeName`, `totals.usd`…). */
export const columnIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, VALIDATION_MESSAGES.invalidFormat)
  .max(64, VALIDATION_MESSAGES.invalidFormat);

/** Pixel width of a resized column. */
export const columnWidthSchema = z.number().int().min(40).max(1200);

/**
 * Value of a `table:<id>:columns` preference. Columns absent from `order` keep their default position;
 * columns absent from `visibility` keep their default visibility.
 */
export const tableColumnsPreferenceSchema = z.object({
  order: z
    .array(columnIdSchema)
    .max(60)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: VALIDATION_MESSAGES.invalidOption,
    })
    .default([]),
  visibility: z.record(columnIdSchema, z.boolean()).default({}),
  widths: z.record(columnIdSchema, columnWidthSchema).default({}),
});
export type TableColumnsPreference = z.infer<typeof tableColumnsPreferenceSchema>;

// ───────────────────────────── Preference keys ─────────────────────────────

export const SIMPLE_PREFERENCE_KEY_VALUES = ["locale", "theme", "timezone"] as const;

/** Any valid `UserPreference.key`. */
export const preferenceKeySchema = z.union([
  z.enum(SIMPLE_PREFERENCE_KEY_VALUES),
  tableColumnsKeySchema,
]);
export type PreferenceKey = z.infer<typeof preferenceKeySchema>;

// ───────────────────────────── Inputs ─────────────────────────────

/** `setPreference`: one key with the value that key accepts. */
export const setPreferenceInputSchema = z.union([
  z.object({ key: z.literal("locale"), value: localeSchema }),
  z.object({ key: z.literal("theme"), value: themeSchema }),
  z.object({ key: z.literal("timezone"), value: timezoneSchema }),
  z.object({ key: tableColumnsKeySchema, value: tableColumnsPreferenceSchema }),
]);
export type SetPreferenceInput = z.infer<typeof setPreferenceInputSchema>;

/** `resetPreference`: removes a stored key so the default applies again ("Restore default columns"). */
export const resetPreferenceInputSchema = z.object({ key: preferenceKeySchema });
export type ResetPreferenceInput = z.infer<typeof resetPreferenceInputSchema>;

/** `getPreferences`: the current user's own preferences (the actor is `ctx.user`). */
export const getPreferencesInputSchema = z.object({}).strict();
export type GetPreferencesInput = z.infer<typeof getPreferencesInputSchema>;

// ───────────────────────────── DTO ─────────────────────────────

export const userPreferencesSchema = z.object({
  locale: localeSchema,
  theme: themeSchema,
  timezone: timezoneSchema,
  /** `tableId` → stored column configuration; tables without an entry use their defaults. */
  tableColumns: z.record(tableIdSchema, tableColumnsPreferenceSchema),
});
export type UserPreferencesDTO = z.infer<typeof userPreferencesSchema>;

// ───────────────────────────── Services ─────────────────────────────

/**
 * Preference services (Settings → Preferencias and the data-table column menu). Every service is
 * `fn(ctx, input) → Promise<DTO>` (C9, C11). They only ever touch the acting user's own rows.
 */
export type PreferencesService<Ctx = unknown> = {
  getPreferences: (ctx: Ctx, input: GetPreferencesInput) => Promise<UserPreferencesDTO>;
  setPreference: (ctx: Ctx, input: SetPreferenceInput) => Promise<UserPreferencesDTO>;
  resetPreference: (ctx: Ctx, input: ResetPreferenceInput) => Promise<UserPreferencesDTO>;
};
