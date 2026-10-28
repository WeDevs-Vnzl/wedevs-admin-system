"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArchivedBanner } from "@/components/patterns/archived-banner";
import { DetailHeader } from "@/components/patterns/detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { TagChips } from "@/features/tags/components/tag-chips";
import type { DocumentDetailDTO } from "@/lib/validators/documents";
import { DocumentStatusDialog } from "./document-status-dialog";
import { allowedDocumentStatuses } from "./document-status-transitions";

export interface DocumentDetailHeaderProps {
  document: Pick<
    DocumentDetailDTO,
    "id" | "code" | "title" | "status" | "archivedAt" | "tags" | "category" | "type"
  >;
  /** `document` UPDATE: editing the metadata and changing the status. */
  canUpdate: boolean;
}

/** Catalog label in the current locale: the English name in English when the catalog has one (PRD §7.8). */
function localName(item: { name: string; nameEn: string | null }, locale: string): string {
  return locale === "en" && item.nameEn ? item.nameEn : item.name;
}

/**
 * Header of `/documents/[id]` (PRD §7.2): code, title, status, category and type, tags, the "Detalle | Grafo" toggle,
 * "Editar datos" (metadata form) and "Cambiar estado" while the status table leaves somewhere to go (S6). An archived
 * document is read-only.
 */
export function DocumentDetailHeader({ document, canUpdate }: DocumentDetailHeaderProps) {
  const t = useTranslations("documents.detail");
  const locale = useLocale();
  const [statusOpen, setStatusOpen] = useState(false);
  const archived = document.archivedAt !== null;
  const editable = canUpdate && !archived;
  const canChangeStatus =
    editable &&
    allowedDocumentStatuses(document.status, document.type.requiresSignature).length > 0;
  const id = encodeURIComponent(document.id);

  return (
    <div className="flex flex-col gap-4">
      <DetailHeader
        backHref="/documents/list"
        code={document.code}
        name={document.title}
        status={<StatusBadge enumName="DocumentStatus" value={document.status} />}
        tags={<TagChips tags={document.tags} />}
        meta={t("meta", {
          category: localName(document.category, locale),
          type: localName(document.type, locale),
        })}
        mode="detail"
        detailHref={`/documents/${id}`}
        graphHref={`/documents/${id}/graph`}
        actions={
          editable ? (
            <>
              <Button variant="outline" asChild>
                <Link href={`/documents/${id}/edit`}>{t("editMeta")}</Link>
              </Button>
              {canChangeStatus ? (
                <Button variant="outline" onClick={() => setStatusOpen(true)}>
                  {t("changeStatus")}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      {archived ? <ArchivedBanner /> : null}

      {canChangeStatus ? (
        <DocumentStatusDialog
          open={statusOpen}
          onOpenChange={setStatusOpen}
          document={{
            id: document.id,
            status: document.status,
            requiresSignature: document.type.requiresSignature,
          }}
        />
      ) : null}
    </div>
  );
}
