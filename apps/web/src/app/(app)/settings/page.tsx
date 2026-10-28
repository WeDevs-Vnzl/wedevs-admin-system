import { redirect } from "next/navigation";

// `/settings` has no content of its own: it opens the first section, Preferencias.
export default function SettingsPage() {
  redirect("/settings/preferences");
}
