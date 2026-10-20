import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Download, FileDiff } from "lucide-react";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import {
  versionFileHref,
  versionHref,
} from "@/features/documents/components/document-version-links";
import { DocumentVersionRestoreButton } from "@/features/documents/components/document-version-restore-button";
import { DocumentVersionViewer } from "@/features/documents/components/document-version-viewer";
import {
  getDocumentDetailPermissions,
  readDocumentDetail,
  readDocumentVersion,
} from "@/features/documents/queries";
import { formatDate } from "@/lib/dates";

type VersionPageProps = {
  params: Promise<{ id: string; versionId: string }>;
};

async function load(id: string, versionId: string) {
  const [document, version] = await Promise.all([
    readDocumentDetail(id),
    readDocumentVersion(id, versionId),
  ]);
  return document && version ? { document, version } : null;
}

export async function generateMetadata({ params }: VersionPageProps): Promise<Metadata> {
  const { id, versionId } = await params;
  const t = await getTranslations("documents");
  const found = await load(id, versionId);
  return {
    title: found
      ? t("versions.page.title", {
          code: found.document.code,
          number: found.version.versionNumber,
        })
      : t("page.listTitle"),
  };
}

// `/documents/[id]/versions/[versionId]` (PRD §8.9.3 "Historial: ver una versión"): one version in the viewer of its
// format, with download, compare with the current one (markdown only) and restore (not on a signed document).
export default async function DocumentVersionPage({ params }: VersionPageProps) {
  const { id, versionId } = await params;
  const found = await load(id, versionId);
  if (!found) notFound();
  const { document, version } = found;
  const [permissions, t, locale] = await Promise.all([
    getDocumentDetailPermissions(),
    getTranslations("documents.versions"),
    getLocale(),
  ]);
  const number = version.versionNumber;
  const documentHref = `/documents/${encodeURIComponent(document.id)}?tab=versions`;
  const canRestore =
    permissions.canUpdate &&
    document.archivedAt === null &&
    document.status !== "FIRMADO" &&
    !version.isCurrent;
  const viewing = t("page.viewing", {
    number,
    name: version.createdBy.name,
    date: formatDate(new Date(version.createdAt), locale, "long"),
  });
  const comparable =
    !version.isCurrent &&
    version.format === "MARKDOWN" &&
    document.currentVersion?.format === "MARKDOWN";

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={document.id} label={`${document.code} · ${document.title}`} />
      <BreadcrumbLabel segment="versions" label={t("title")} />
      <BreadcrumbLabel segment={version.id} label={t("label", { number })} />
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={documentHref}>
            <ArrowLeft aria-hidden />
            {t("page.back")}
          </Link>
        </Button>
      </div>
      <PageHeader
        title={t("page.title", { code: document.code, number })}
        description={version.isCurrent ? `${viewing} ${t("page.currentNotice")}` : viewing}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a
                href={versionFileHref(document.id, version, true)}
                {...(version.format === "ENLACE"
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                <Download aria-hidden />
                {t("download", { number })}
              </a>
            </Button>
            {comparable ? (
              <Button variant="outline" asChild>
                <Link href={versionHref(document.id, version.id, "/compare")}>
                  <FileDiff aria-hidden />
                  {t("compare", { number })}
                </Link>
              </Button>
            ) : null}
            {canRestore ? (
              <DocumentVersionRestoreButton
                documentId={document.id}
                versionId={version.id}
                versionNumber={number}
                appearance="text"
                redirectTo={documentHref}
              />
            ) : null}
          </div>
        }
      />
      {version.changelog ? <p className="text-sm">{version.changelog}</p> : null}
      <DocumentVersionViewer documentId={document.id} version={version} />
    </div>
  );
}
