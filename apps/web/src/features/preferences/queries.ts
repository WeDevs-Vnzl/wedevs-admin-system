import "server-only";
import { redirect } from "next/navigation";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import {
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  DEFAULT_TIMEZONE,
  type UserPreferencesDTO,
} from "@/lib/validators/preferences";

const DEFAULT_PREFERENCES: UserPreferencesDTO = {
  locale: DEFAULT_LOCALE,
  theme: DEFAULT_THEME,
  timezone: DEFAULT_TIMEZONE,
  tableColumns: {},
};

/**
 * The signed-in user's preferences: locale, theme, time zone and the column layout of each table. Preferences
 * are cosmetic, so a failed read (other than a lost session) shows the defaults instead of breaking the page.
 */
export async function getPreferences(): Promise<UserPreferencesDTO> {
  const api = await getServerApi();
  const result = toActionResult(await api.GET("/api/v1/me/preferences"));
  if (result.ok) return result.data;
  if (result.error.code === "UNAUTHENTICATED") redirect(result.error.redirectTo ?? "/sign-in");
  console.error("[preferences] read failed, using defaults", result.error.code);
  return DEFAULT_PREFERENCES;
}
