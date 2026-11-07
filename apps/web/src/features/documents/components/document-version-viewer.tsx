"use client";

import { useTranslations } from "next-intl";
import { Download, ExternalLink, FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownView } from "@/components/ui/markdown-view/markdown-view";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import type { DocumentVersionDetailDTO } from "@/lib/validators/documents";
import { safeExternalUrl, versionFileHref } from "./document-version-links";

export interface DocumentVersionViewerProps {
  documentId: string;
  version: DocumentVersionDetailDTO;
}

/**
 * The viewer of one version by its format (PRD §8.9.5 "visor según el formato"): sanitized markdown, a PDF in the
 * `PdfViewer` (bytes through the authenticated file route), any other file as a download card, and a link as an external
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
    // Only an `http(s)` address is linked; any other scheme is shown as text.
    const href = safeExternalUrl(version.url);
    return (
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link2 className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">{t("linkDescription")}</p>
            <p className="truncate text-sm font-medium">{version.url}</p>
          </div>
        </div>
        {href ? (
          <Button variant="outline" asChild>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {t("openLink")}
            </a>
          </Button>
        ) : null}
      </div>
    );
  }

  // `ARCHIVO` versions view and download through the authenticated file route (DT-206).
  const downloadHref = versionFileHref(documentId, version);
  if (downloadHref && version.file?.mimeType === "application/pdf") {
    return (
      <PdfViewer
        url={downloadHref}
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
      {downloadHref ? (
        <Button variant="outline" asChild>
          <a href={downloadHref}>
            <Download aria-hidden />
            {t("download")}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
