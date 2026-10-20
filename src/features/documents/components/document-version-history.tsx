"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download, Eye, FileDiff, History } from "lucide-react";
import { DateText } from "@/components/patterns/date-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DocumentVersionRowDTO } from "@/lib/validators/documents";
import { versionFileHref, versionHref } from "./document-version-links";
import { DocumentVersionRestoreButton } from "./document-version-restore-button";

export interface DocumentVersionHistoryProps {
  documentId: string;
  /** Newest first, as `listDocumentVersions` returns them. */
  versions: readonly DocumentVersionRowDTO[];
  /** `document` UPDATE: restoring is a change of the document. */
  canUpdate: boolean;
  /** A `FIRMADO` document accepts no new version, so nothing can be restored (S5 "Bloqueo por firma"). */
  signed: boolean;
}

/**
 * *Versiones* tab (PRD §8.9.3 "Historial"): every version with its author, date and change notes. Each one can be
 * viewed and downloaded; a markdown version can be compared with the current one when that is markdown too, and an
 * older version can be restored (a new version N+1 copying it).
 */
export function DocumentVersionHistory({
  documentId,
  versions,
  canUpdate,
  signed,
}: DocumentVersionHistoryProps) {
  const t = useTranslations("documents.versions");
  const tFormat = useTranslations("enums.DocumentFormat");

  if (versions.length === 0) {
    return <EmptyState icon={History} title={t("empty")} />;
  }

  const current = versions.find((version) => version.isCurrent);
  const canRestore = canUpdate && !signed;

  return (
    <ul className="divide-y rounded-2xl border bg-card">
      {versions.map((version) => {
        const number = version.versionNumber;
        const comparable =
          !version.isCurrent && version.format === "MARKDOWN" && current?.format === "MARKDOWN";
        const external = version.format === "ENLACE";
        return (
          <li
            key={version.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">{t("label", { number })}</span>
                <Badge variant="outline">{tFormat(version.format)}</Badge>
                {version.isCurrent ? <Badge>{t("current")}</Badge> : null}
              </div>
              <p className={version.changelog ? "text-sm" : "text-sm text-muted-foreground italic"}>
                {version.changelog ?? t("noChangelog")}
              </p>
              <p className="text-xs text-muted-foreground">
                {version.createdBy.name} · <DateText value={new Date(version.createdAt)} />
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="icon-sm" asChild>
                <Link href={versionHref(documentId, version.id)} aria-label={t("view", { number })}>
                  <Eye aria-hidden />
                </Link>
              </Button>
              <Button variant="ghost" size="icon-sm" asChild>
                <a
                  href={versionFileHref(documentId, version, true)}
                  aria-label={t("download", { number })}
                  {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                >
                  <Download aria-hidden />
                </a>
              </Button>
              {comparable ? (
                <Button variant="ghost" size="icon-sm" asChild>
                  <Link
                    href={versionHref(documentId, version.id, "/compare")}
                    aria-label={t("compare", { number })}
                  >
                    <FileDiff aria-hidden />
                  </Link>
                </Button>
              ) : null}
              {canRestore && !version.isCurrent ? (
                <DocumentVersionRestoreButton
                  documentId={documentId}
                  versionId={version.id}
                  versionNumber={number}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
