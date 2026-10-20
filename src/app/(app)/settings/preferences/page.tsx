import { getLocale } from "next-intl/server";
import { getPreferences } from "@/features/preferences/queries";
import { PreferencesForm } from "@/features/settings/components/preferences-form";
import { defaultLocale, isLocale } from "@/i18n/config";

// IANA zones the browser runtime knows (Node 24 ships the full list); the form offers them all.
const TIMEZONES: readonly string[] = Intl.supportedValuesOf("timeZone");

export default async function PreferencesPage() {
  // The active request locale (the NEXT_LOCALE cookie wins in Hito 1, frontend-patterns §15), not the stored
  // preference, so the form starts from the language the topbar shows (M3).
  const requestLocale = await getLocale();
  const locale = isLocale(requestLocale) ? requestLocale : defaultLocale;
  const { theme, timezone } = await getPreferences();

  return <PreferencesForm initial={{ locale, theme, timezone }} timezones={TIMEZONES} />;
}
