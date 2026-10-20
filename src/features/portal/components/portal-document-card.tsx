"use client";

import {
  CodeIcon,
  DownloadIcon,
  EyeIcon,
  FileTextIcon,
  LinkIcon,
  LockIcon,
  type LucideIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocumentFormat } from "@/lib/validators/enums";
import type { PortalDocumentDTO } from "@/lib/validators/shares";
import { cn } from "@/lib/utils";

const FORMAT_ICONS: Record<DocumentFormat, LucideIcon> = {
  ARCHIVO: FileTextIcon,
  MARKDOWN: CodeIcon,
  ENLACE: LinkIcon,
};

/** The portal route of a shared document; `download` asks for an attachment (logged as `DOWNLOAD`). */
export function portalFileUrl(token: string, documentId: string, download = false): string {
  const base = `/api/s/${token}/files/${encodeURIComponent(documentId)}`;
  return download ? `${base}?download=1` : base;
}

export interface PortalDocumentCardProps {
  token: string;
  document: PortalDocumentDTO;
  allowDownload: boolean;
  selected: boolean;
  onView: () => void;
  onUnlock: () => void;
}

/**
 * A document of the portal (wireframe 4.8): icon, title, "type · vN · format", and "Ver" / "Descargar". A
 * key-protected document the visitor has not unlocked shows "Requiere clave" and a single "Desbloquear" (DT-45).
 */
export function PortalDocumentCard({
  token,
  document,
  allowDownload,
  selected,
  onView,
  onUnlock,
}: PortalDocumentCardProps) {
  const t = useTranslations("portal");
  const locale = useLocale();
  const Icon = document.locked ? LockIcon : FORMAT_ICONS[document.format];
  const typeName = locale === "en" ? (document.typeNameEn ?? document.typeName) : document.typeName;
  const titleId = `portal-doc-${document.documentId}`;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "rounded-xl border bg-card p-4 text-card-foreground transition-colors",
        selected ? "border-foreground ring-1 ring-foreground" : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold break-words">
            {document.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              typeName,
              t("document.version", { version: document.versionNumber }),
              t(`formats.${document.format}`),
            ].join(" · ")}
          </p>
          {document.locked ? (
            <Badge variant="outline" className="mt-2 gap-1">
              <LockIcon aria-hidden />
              {t("document.locked")}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex gap-2 border-t pt-3">
        {document.locked ? (
          <Button type="button" className="flex-1" onClick={onUnlock}>
            <LockIcon aria-hidden />
            {t("actions.unlock")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              aria-pressed={selected}
              onClick={onView}
            >
              <EyeIcon aria-hidden />
              {t("actions.view")}
            </Button>
            {allowDownload ? (
              <Button asChild className="flex-1">
                <a href={portalFileUrl(token, document.documentId, true)} rel="noreferrer" download>
                  <DownloadIcon aria-hidden />
                  {t("actions.download")}
                </a>
              </Button>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
