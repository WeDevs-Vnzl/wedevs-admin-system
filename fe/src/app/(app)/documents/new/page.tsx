import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DocumentForm } from "@/features/documents/components/document-form";
import {
  documentLinkPrefill,
  getDocumentPermissions,
  listDocumentCategories,
} from "@/features/documents/queries";
import { canCreateTagsInline } from "@/features/tags/queries";

type NewDocumentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.page");
  return { title: t("newTitle") };
}

// `/documents/new` (PRD §8.9): a new `BORRADOR` document. `?entityType=&entityId=` links it to the client or the
// project it is created from (2881). Owner, Admin and Member create documents; Viewers get the not-found page.
export default async function NewDocumentPage({ searchParams }: NewDocumentPageProps) {
  const permissions = await getDocumentPermissions();
  if (!permissions.canCreate) notFound();
  const params = await searchParams;
  const entityType = typeof params.entityType === "string" ? params.entityType : undefined;
  const entityId = typeof params.entityId === "string" ? params.entityId : undefined;
  const [categories, initialLinks, canCreateTags, t] = await Promise.all([
    listDocumentCategories(),
    documentLinkPrefill(entityType, entityId),
    canCreateTagsInline(),
    getTranslations("documents.page"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment="new" label={t("newTitle")} />
      <DocumentForm
        categories={categories}
        initialLinks={initialLinks}
        canCreateTags={canCreateTags}
      />
    </div>
  );
}
