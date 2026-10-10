import { getPreferences } from "@/features/preferences/queries";
import { PreferencesForm } from "@/features/settings/components/preferences-form";

// IANA zones the browser runtime knows (Node 24 ships the full list); the form offers them all.
const TIMEZONES: readonly string[] = Intl.supportedValuesOf("timeZone");

export default async function PreferencesPage() {
  const { locale, theme, timezone } = await getPreferences();

  return <PreferencesForm initial={{ locale, theme, timezone }} timezones={TIMEZONES} />;
}
