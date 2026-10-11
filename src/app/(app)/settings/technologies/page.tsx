import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { getOpenableSettingsSection } from "@/features/settings/queries";
import { resolveTechnologyIcon } from "@/features/technologies/components/tech-stack-icons";
import { TechnologiesTable } from "@/features/technologies/components/technologies-table";
import { listTechnologies, technologyFilterFromParams } from "@/features/technologies/queries";

export async function generateMetadata() {
  const t = await getTranslations("catalogs.technologies");
  return { title: t("page.title") };
}

type TechnologiesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Settings → Tecnologías (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function TechnologiesPage({ searchParams }: TechnologiesPageProps) {
  const section = await getOpenableSettingsSection("technologies");
  if (!section) notFound();

  const t = await getTranslations("catalogs.technologies");
  const page = await listTechnologies(technologyFilterFromParams(await searchParams));
  // Brand icons are resolved here, on the server; the client table gets plain data (see tech-stack-icons.tsx).
  const icons = Object.fromEntries(page.items.map((row) => [row.id, resolveTechnologyIcon(row.iconSlug)]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={page.total} />
      <TechnologiesTable rows={page.items} total={page.total} icons={icons} />
    </div>
  );
}
