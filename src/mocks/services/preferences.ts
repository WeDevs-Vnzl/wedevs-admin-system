// MOCK — preference services of Hito 1 (PRD §8.15, DT-43). `fn(ctx, input)`, framework-free (C11). They
// only touch the acting user's own rows. Replaced by `preferences.service.ts` over `UserPreference` in
// Hito 2 (C9).
import {
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  localeSchema,
  parseTableColumnsKey,
  tableColumnsPreferenceSchema,
  themeSchema,
  timezoneSchema,
  type GetPreferencesInput,
  type ResetPreferenceInput,
  type SetPreferenceInput,
  type UserPreferencesDTO,
} from "@/lib/validators/preferences";
import type { MockServiceContext } from "../ctx";

/** The acting user's preferences; keys never stored fall back to the session user, then to the defaults. */
export async function getPreferences(
  ctx: MockServiceContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- PRD §12 signature: fn(ctx, input)
  _input: GetPreferencesInput,
): Promise<UserPreferencesDTO> {
  const preferences: UserPreferencesDTO = {
    locale: ctx.user.locale ?? DEFAULT_LOCALE,
    theme: ctx.user.theme ?? DEFAULT_THEME,
    timezone: DEFAULT_TIMEZONE,
    tableColumns: {},
  };
  for (const row of ctx.db.preferences) {
    if (row.userId !== ctx.user.id) continue;
    // Stored values were validated on write; parsing again keeps a corrupted row from reaching the UI.
    if (row.key === "locale") {
      const parsed = localeSchema.safeParse(row.value);
      if (parsed.success) preferences.locale = parsed.data;
    } else if (row.key === "theme") {
      const parsed = themeSchema.safeParse(row.value);
      if (parsed.success) preferences.theme = parsed.data;
    } else if (row.key === "timezone") {
      const parsed = timezoneSchema.safeParse(row.value);
      if (parsed.success) preferences.timezone = parsed.data;
    } else {
      const tableId = parseTableColumnsKey(row.key);
      const parsed = tableColumnsPreferenceSchema.safeParse(row.value);
      if (tableId !== null && parsed.success) preferences.tableColumns[tableId] = parsed.data;
    }
  }
  return preferences;
}

/** Stores one preference of the acting user (replacing its previous value) and returns them all. */
export async function setPreference(
  ctx: MockServiceContext,
  input: SetPreferenceInput,
): Promise<UserPreferencesDTO> {
  const existing = ctx.db.preferences.find(
    (row) => row.userId === ctx.user.id && row.key === input.key,
  );
  if (existing) {
    existing.value = structuredClone(input.value);
  } else {
    ctx.db.preferences.push({
      userId: ctx.user.id,
      key: input.key,
      value: structuredClone(input.value),
    });
  }
  return getPreferences(ctx, {});
}

/** Removes a stored key so its default applies again ("Restore default columns"). */
export async function resetPreference(
  ctx: MockServiceContext,
  input: ResetPreferenceInput,
): Promise<UserPreferencesDTO> {
  ctx.db.preferences = ctx.db.preferences.filter(
    (row) => !(row.userId === ctx.user.id && row.key === input.key),
  );
  return getPreferences(ctx, {});
}
