import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DocumentEditor } from "@/features/documents/components/document-editor";
import { getDocumentEditor } from "@/features/documents/editor-queries";

type DocumentEditorPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: DocumentEditorPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("documentEditor.page");
  const editor = await getDocumentEditor(id);
  return { title: editor ? `${t("title")} · ${editor.document.code}` : t("title") };
}

// `/documents/[id]/editor` (PRD §8.9.3, wireframe 4.9): the markdown editor. Viewers, unknown and archived
// documents answer not-found; a signed document opens read-only and a file or link document explains why it
// has no editor (`getDocumentEditor`).
export default async function DocumentEditorPage({ params }: DocumentEditorPageProps) {
  const { id } = await params;
  const editor = await getDocumentEditor(id);
  if (!editor) notFound();

  return (
    <>
      <BreadcrumbLabel segment={editor.document.id} label={editor.document.code} />
      <DocumentEditor
        document={editor.document}
        availability={editor.availability}
        initialContent={editor.content}
      />
    </>
  );
}
