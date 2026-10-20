import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { versionHref } from "@/features/documents/components/document-version-links";
import { DocumentVersionDiff } from "@/features/documents/components/document-version-diff";
import { readDocumentDetail, readDocumentVersion } from "@/features/documents/queries";

type ComparePageProps = {
  params: Promise<{ id: string; versionId: string }>;
};

async function load(id: string, versionId: string) {
  const [document, version] = await Promise.all([
    readDocumentDetail(id),
    readDocumentVersion(id, versionId),
  ]);
  return document && version ? { document, version } : null;
}

export async function generateMetadata({ params }: ComparePageProps): Promise<Metadata> {
  const { id, versionId } = await params;
  const t = await getTranslations("documents");
  const found = await load(id, versionId);
  const current = found?.document.currentVersion;
  return {
    title:
      found && current
        ? t("versions.page.compareTitle", {
            code: found.document.code,
            number: found.version.versionNumber,
            current: current.versionNumber,
          })
        : t("page.listTitle"),
  };
}

// `/documents/[id]/versions/[versionId]/compare` (PRD §8.9.3 "compararla con la vigente (diff de texto, solo en
// markdown)", HU-18 CA3): the line diff of this version against the current one. Either side not markdown says so.
export default async function DocumentVersionComparePage({ params }: ComparePageProps) {
  const { id, versionId } = await params;
  const found = await load(id, versionId);
  if (!found) notFound();
  const { document, version } = found;
  const current = document.currentVersion;
  if (!current) notFound();
  const t = await getTranslations("documents.versions");
  const number = version.versionNumber;
  const markdown = version.format === "MARKDOWN" && current.format === "MARKDOWN";

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={document.id} label={`${document.code} · ${document.title}`} />
      <BreadcrumbLabel segment="versions" label={t("title")} />
      <BreadcrumbLabel segment={version.id} label={t("label", { number })} />
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href={versionHref(document.id, version.id)}>
            <ArrowLeft aria-hidden />
            {t("view", { number })}
          </Link>
        </Button>
      </div>
      <PageHeader
        title={t("page.compareTitle", {
          code: document.code,
          number,
          current: current.versionNumber,
        })}
        description={
          markdown
            ? t("page.compareDescription", { number, current: current.versionNumber })
            : undefined
        }
      />
      {markdown ? (
        <DocumentVersionDiff before={version.content ?? ""} after={current.content ?? ""} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("page.compareOnlyMarkdown")}</p>
      )}
    </div>
  );
}
