"use client";

import { DownloadIcon, ExternalLinkIcon, FileTextIcon, LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { PrintButton, PrintRegion } from "@/components/patterns/print-view";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MarkdownView } from "@/components/ui/markdown-view/markdown-view";
import { PdfViewer } from "@/components/ui/pdf-viewer";
import { Spinner } from "@/components/ui/spinner";
import type { PortalDocumentDTO, PortalDocumentViewDTO } from "@/lib/validators/shares";
import { openSharedDocumentAction } from "../actions";
import { portalFileUrl } from "./portal-document-card";

/** Result of one load, tagged with the document and attempt it was started for (anything else is still loading). */
type ViewState =
  { status: "error"; key: string } | { status: "ready"; key: string; view: PortalDocumentViewDTO };

export interface PortalViewerProps {
  token: string;
  /** The open document; `null` shows the empty state. */
  document: PortalDocumentDTO | null;
  allowDownload: boolean;
}

/**
 * Viewer panel of the portal (PRD §8.11 "Comportamiento del portal"): embedded PDF, sanitized markdown with print,
 * image, or an external link as a button. Opening a document records its `VIEW` (Server Action).
 */
export function PortalViewer({ token, document, allowDownload }: PortalViewerProps) {
  const t = useTranslations("portal.viewer");
  const documentId = document?.documentId ?? null;
  const [state, setState] = useState<ViewState | null>(null);
  const [attempt, setAttempt] = useState(0);

  const loadKey = `${documentId}#${attempt}`;

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    openSharedDocumentAction({ token, documentId })
      .then((result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { status: "ready", key: loadKey, view: result.data }
            : { status: "error", key: loadKey },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", key: loadKey });
      });
    return () => {
      cancelled = true;
    };
  }, [token, documentId, loadKey]);

  const current = state?.key === loadKey ? state : null;

  return (
    <section
      aria-label={t("label")}
      className="min-h-80 min-w-0 rounded-xl border bg-muted/40 p-3 sm:p-4"
    >
      {!document ? (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon aria-hidden />
            </EmptyMedia>
            <EmptyDescription>{t("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !current ? (
        <div
          role="status"
          className="flex h-80 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner aria-hidden />
          {t("loading")}
        </div>
      ) : current.status === "error" ? (
        <div className="flex h-80 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
          <p role="alert">{t("error")}</p>
          <RetryButton onRetry={() => setAttempt((value) => value + 1)} />
        </div>
      ) : (
        <ViewerContent token={token} view={current.view} allowDownload={allowDownload} />
      )}
    </section>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("common");
  return (
    <Button type="button" variant="outline" size="sm" onClick={onRetry}>
      {t("actions.retry")}
    </Button>
  );
}

function ViewerContent({
  token,
  view,
  allowDownload,
}: {
  token: string;
  view: PortalDocumentViewDTO;
  allowDownload: boolean;
}) {
  const t = useTranslations("portal");
  const { document, content } = view;
  const fileUrl = portalFileUrl(token, document.documentId);
  const downloadUrl = portalFileUrl(token, document.documentId, true);

  if (content.format === "MARKDOWN") {
    return (
      <div className="rounded-lg border bg-background p-4 sm:p-8">
        <div className="mb-4 flex justify-end" data-print-hide="">
          <PrintButton />
        </div>
        <PrintRegion
          title={document.title}
          subtitle={t("document.version", { version: document.versionNumber })}
        >
          <MarkdownView content={content.markdown} />
        </PrintRegion>
      </div>
    );
  }

  if (content.format === "ENLACE") {
    return (
      <Empty className="h-80">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LinkIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{document.title}</EmptyTitle>
          <EmptyDescription>{t("viewer.linkDescription")}</EmptyDescription>
        </EmptyHeader>
        <Button asChild>
          <a href={content.url} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon aria-hidden />
            {t("actions.openLink")}
          </a>
        </Button>
      </Empty>
    );
  }

  if (content.preview === "pdf") {
    return (
      <PdfViewer
        url={fileUrl}
        {...(allowDownload ? { onDownload: () => window.location.assign(downloadUrl) } : {})}
      />
    );
  }

  if (content.preview === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a private, uncached file of the portal route.
      <img
        src={fileUrl}
        alt={document.title}
        className="mx-auto max-h-[70vh] rounded-lg border bg-background object-contain"
      />
    );
  }

  return (
    <Empty className="h-80">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{content.fileName}</EmptyTitle>
        <EmptyDescription>
          {allowDownload ? t("viewer.noPreview") : t("viewer.noPreviewNoDownload")}
        </EmptyDescription>
      </EmptyHeader>
      {allowDownload ? (
        <Button asChild>
          <a href={downloadUrl} rel="noreferrer" download>
            <DownloadIcon aria-hidden />
            {t("actions.download")}
          </a>
        </Button>
      ) : null}
    </Empty>
  );
}
