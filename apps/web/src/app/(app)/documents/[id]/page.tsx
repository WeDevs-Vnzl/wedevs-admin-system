import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { EntityActivityTab } from "@/features/activity/components/entity-activity-tab";
import { DocumentDetailContent } from "@/features/documents/components/document-detail-content";
import { DocumentDetailHeader } from "@/features/documents/components/document-detail-header";
import { DocumentDetailLinks } from "@/features/documents/components/document-detail-links";
import { DocumentDetailPanel } from "@/features/documents/components/document-detail-panel";
import { DocumentDetailTabs } from "@/features/documents/components/document-detail-tabs";
import { DocumentVersionHistory } from "@/features/documents/components/document-version-history";
import { DocumentVersionUploadDialog } from "@/features/documents/components/document-version-upload-dialog";
import {
  getDocumentDetailPermissions,
  listDocumentVersions,
  readDocumentDetail,
} from "@/features/documents/queries";
import { EntityNotesTab } from "@/features/notes/components/entity-notes-tab";
import { DocumentSharesTab } from "@/features/shares/components/document-shares-tab";
import type { EntityRef } from "@/lib/validators/common";

type DocumentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: DocumentDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("documents.page");
  const document = await readDocumentDetail(id);
  return { title: document ? `${document.code} · ${document.title}` : t("listTitle") };
}

// `/documents/[id]` (PRD §8.9.5 "Detalle", S5–S7): header with status changes, the side panel and the tabs Contenido,
// Versiones, Vínculos, Compartir, Notas, Actividad (only for roles that read the log) and Grafo (A1: links to
// `/documents/[id]/graph`). Unknown ids, and archived documents for roles without the trash grant, answer not-found.
// An archived document is read-only.
export default async function DocumentDetailPage({ params }: DocumentDetailPageProps) {
  const { id } = await params;
  const document = await readDocumentDetail(id);
  if (!document) notFound();
  const [versions, permissions, t] = await Promise.all([
    listDocumentVersions(document.id),
    getDocumentDetailPermissions(),
    getTranslations("documents.versions"),
  ]);
  const canUpdate = permissions.canUpdate && document.archivedAt === null;
  const signed = document.status === "FIRMADO";
  const format = document.currentVersion?.format ?? document.type.defaultFormat;
  const ref: EntityRef = {
    type: "DOCUMENT",
    id: document.id,
    code: document.code,
    label: document.title,
  };

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={document.id} label={`${document.code} · ${document.title}`} />
      <DocumentDetailHeader document={document} canUpdate={permissions.canUpdate} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <DocumentDetailTabs
            documentId={document.id}
            versionCount={document.versionCount}
            linkCount={document.links.length}
            content={<DocumentDetailContent document={document} canUpdate={canUpdate} />}
            versions={
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-prose text-sm text-muted-foreground">{t("description")}</p>
                  {canUpdate && format !== "MARKDOWN" ? (
                    <DocumentVersionUploadDialog
                      documentId={document.id}
                      format={format}
                      signed={signed}
                    />
                  ) : null}
                </div>
                <DocumentVersionHistory
                  documentId={document.id}
                  versions={versions}
                  canUpdate={canUpdate}
                  signed={signed}
                />
              </div>
            }
            links={
              <DocumentDetailLinks
                documentId={document.id}
                links={document.links}
                canUpdate={canUpdate}
              />
            }
            shares={<DocumentSharesTab documentId={document.id} />}
            notes={<EntityNotesTab entity={ref} />}
            activity={
              permissions.canReadActivity ? (
                <EntityActivityTab entity={{ type: "DOCUMENT", id: document.id }} />
              ) : null
            }
          />
        </div>
        <aside className="space-y-6">
          <DocumentDetailPanel document={document} />
        </aside>
      </div>
    </div>
  );
}
