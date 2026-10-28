import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DocumentForm } from "@/features/documents/components/document-form";
import {
  getDocument,
  getDocumentPermissions,
  listDocumentCategories,
} from "@/features/documents/queries";
import { canCreateTagsInline } from "@/features/tags/queries";
import { ServiceError } from "@/server/context";

type EditDocumentPageProps = {
  params: Promise<{ id: string }>;
};

async function readDocument(id: string) {
  try {
    return await getDocument(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: EditDocumentPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("documents.page");
  const document = await readDocument(id);
  return { title: document ? `${t("editTitle")} · ${document.code}` : t("editTitle") };
}

// `/documents/[id]/edit` (PRD §8.9): the metadata of a document, on the same form as a new one. Content, status
// and links change from the detail. An archived document is read-only: the page answers not-found.
export default async function EditDocumentPage({ params }: EditDocumentPageProps) {
  const { id } = await params;
  const permissions = await getDocumentPermissions();
  if (!permissions.canUpdate) notFound();
  const document = await readDocument(id);
  if (!document || document.archivedAt !== null) notFound();
  const [categories, canCreateTags] = await Promise.all([
    listDocumentCategories(),
    canCreateTagsInline(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={document.id} label={document.code} />
      <DocumentForm document={document} categories={categories} canCreateTags={canCreateTags} />
    </div>
  );
}
