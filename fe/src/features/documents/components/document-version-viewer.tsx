"use client";

import { useTranslations } from "next-intl";
import { Download, ExternalLink, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/ui/markdown-view/markdown-view";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import type { DocumentVersionDetailDTO } from "@/lib/validators/documents";
import { versionFileHref } from "./document-version-links";

export interface DocumentVersionViewerProps {
  documentId: string;
  version: DocumentVersionDetailDTO;
}

/**
 * The viewer of one version by its format (PRD §8.9.5 "visor según el formato"): sanitized markdown, a PDF in the
 * `PdfViewer` (bytes from the version file route), any other file as a download card, and a link as an external
 * address opened in a new tab.
 */
export function DocumentVersionViewer({ documentId, version }: DocumentVersionViewerProps) {
  const t = useTranslations("documents.detail.content");

  if (version.format === "MARKDOWN") {
    return (
      <div className="rounded-2xl border bg-card p-6">
        <MarkdownView content={version.content ?? ""} />
      </div>
    );
  }

  if (version.format === "ENLACE") {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{t("linkDescription")}</p>
            <p className="truncate text-sm font-medium">{version.url}</p>
          </div>
        </div>
        {version.url ? (
          <Button variant="outline" asChild>
            <a href={version.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {t("openLink")}
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  const downloadHref = versionFileHref(documentId, version, true);
  if (version.file?.mimeType === "application/pdf") {
    return (
      <PdfViewer
        url={versionFileHref(documentId, version, false)}
        onDownload={() => window.location.assign(downloadHref)}
        className="h-[720px]"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium">{version.file?.originalName}</p>
          <p className="text-sm text-muted-foreground">{t("fileDescription")}</p>
        </div>
      </div>
      <Button variant="outline" asChild>
        <a href={downloadHref}>
          <Download aria-hidden />
          {t("download")}
        </a>
      </Button>
    </div>
  );
}
