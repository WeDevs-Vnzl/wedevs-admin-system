import { notFound } from "next/navigation";
import { SectionPlaceholder } from "@/features/settings/components/section-placeholder";
import { getOpenableSettingsSection } from "@/features/settings/queries";

type SettingsSectionPageProps = {
  params: Promise<{ section: string }>;
};

// Fallback for `/settings/<slug>`: every §8.15 section has its own page since H1-B5 (company, users and trash
// were the last), so this only renders the placeholder for a section added to the config before its page.
// Unknown slugs and sections the role cannot open render the in-shell not-found page.
export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { section } = await params;
  const openable = await getOpenableSettingsSection(section);
  if (!openable) notFound();

  return <SectionPlaceholder />;
}
