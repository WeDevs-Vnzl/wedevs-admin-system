import { notFound } from "next/navigation";
import { SectionPlaceholder } from "@/features/settings/components/section-placeholder";
import { getOpenableSettingsSection } from "@/features/settings/queries";

type SettingsSectionPageProps = {
  params: Promise<{ section: string }>;
};

// The Configuración sections not built in Hito 1 B1 (every §8.15 slug except preferences, which has its own
// page). Unknown slugs and sections the role cannot open render the in-shell not-found page.
export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { section } = await params;
  const openable = await getOpenableSettingsSection(section);
  if (!openable) notFound();

  return <SectionPlaceholder />;
}
