import "server-only";
import * as preferences from "@/mocks/services/preferences";
import { getServiceContext } from "@/server/context";
import type { UserPreferencesDTO } from "@/lib/validators/preferences";

/** The signed-in user's preferences: locale, theme, time zone and the column layout of each table. */
export async function getPreferences(): Promise<UserPreferencesDTO> {
  const ctx = await getServiceContext();
  return preferences.getPreferences(ctx, {});
}
