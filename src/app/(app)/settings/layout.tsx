import type { ReactNode } from "react";
import { SettingsNav } from "@/features/settings/components/settings-nav";
import { getVisibleSettingsSections } from "@/features/settings/queries";

// Configuración frame (PRD §8.15): section navigation on the left (a row on small screens), the section on the
// right. Sections are filtered per role with can(); the nested `(app)` layout provides the shell around it.
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const sections = await getVisibleSettingsSections();

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
      <SettingsNav slugs={sections.map((section) => section.slug)} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
