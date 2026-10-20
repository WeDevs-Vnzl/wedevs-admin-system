import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DocumentsOverview } from "@/features/documents/components/documents-overview";
import { getDocumentPermissions, getDocumentsOverview } from "@/features/documents/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.page");
  return { title: t("overviewTitle") };
}

// `/documents` overview (PRD §8.9.5, DT-25: the overview is not the list). Every role reads documents
// (`document` READ); the create action shows only to the roles that may create.
export default async function DocumentsOverviewPage() {
  const [overview, permissions] = await Promise.all([
    getDocumentsOverview(),
    getDocumentPermissions(),
  ]);

  return <DocumentsOverview overview={overview} canCreate={permissions.canCreate} />;
}
