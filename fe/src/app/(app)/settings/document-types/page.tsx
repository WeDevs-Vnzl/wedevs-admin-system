import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { DocumentTypesSettings } from "@/features/document-types/components/document-types-settings";
import { listDocumentCategories } from "@/features/document-types/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata() {
  const t = await getTranslations("catalogs.documentTypes");
  return { title: t("page.title") };
}

// Settings → Tipos de documento (PRD §8.9.1, HU-21): Owner and Admin only. Other roles get the in-shell
// not-found page.
export default async function DocumentTypesPage() {
  const section = await getOpenableSettingsSection("document-types");
  if (!section) notFound();

  const t = await getTranslations("catalogs.documentTypes");
  const categories = await listDocumentCategories();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <DocumentTypesSettings categories={categories} />
    </div>
  );
}
