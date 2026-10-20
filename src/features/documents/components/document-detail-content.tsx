"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FilePlus2, Lock, PenLine, Printer } from "lucide-react";
import { DateText } from "@/components/patterns/date-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import type { DocumentDetailDTO } from "@/lib/validators/documents";
import { DocumentVersionUploadDialog } from "./document-version-upload-dialog";
import { DocumentVersionViewer } from "./document-version-viewer";

export interface DocumentDetailContentProps {
  document: DocumentDetailDTO;
  /** `document` UPDATE: editing markdown and publishing file or link versions. */
  canUpdate: boolean;
}

/**
 * *Contenido* tab (PRD §8.9.5 "Detalle"): the current version in the viewer of its format, "Editar" to the markdown
 * editor, "Imprimir / Guardar como PDF" on markdown, and "Subir nueva versión" / "Actualizar enlace" on files and
 * links. A `FIRMADO` document accepts no new version (S5 "Bloqueo por firma"), so none of the writing actions show.
 */
export function DocumentDetailContent({ document, canUpdate }: DocumentDetailContentProps) {
  const t = useTranslations("documents.detail");
  const version = document.currentVersion;
  const signed = document.status === "FIRMADO";
  const format = version?.format ?? document.type.defaultFormat;
  const editorHref = `/documents/${encodeURIComponent(document.id)}/editor`;
  const canEditMarkdown = canUpdate && !signed && format === "MARKDOWN";

  const editLink = canEditMarkdown ? (
    <Button asChild>
      <Link href={editorHref}>
        <PenLine aria-hidden />
        {t("content.edit")}
      </Link>
    </Button>
  ) : null;
  const versionAction =
    canUpdate && format !== "MARKDOWN" ? (
      <DocumentVersionUploadDialog documentId={document.id} format={format} signed={signed} />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          {signed ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" aria-hidden />
              {t("signedLock")}
            </p>
          ) : null}
          {document.draftContent !== null && document.draftUpdatedAt && canEditMarkdown ? (
            <p className="text-sm text-muted-foreground">
              {t.rich("content.draftNotice", {
                date: () => <DateText value={new Date(document.draftUpdatedAt!)} style="long" />,
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {version?.format === "MARKDOWN" ? (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden />
              {t("content.print")}
            </Button>
          ) : null}
          {editLink}
          {versionAction}
        </div>
      </div>

      {version ? (
        <DocumentVersionViewer documentId={document.id} version={version} />
      ) : (
        <EmptyState
          icon={FilePlus2}
          title={t("content.emptyTitle")}
          description={
            format === "MARKDOWN" ? t("content.emptyMarkdown") : t("content.emptyDescription")
          }
        />
      )}
    </div>
  );
}
