"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Network } from "lucide-react";
import { DetailTabs, type DetailTab } from "@/components/patterns/detail-tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

export interface DocumentDetailTabsProps {
  documentId: string;
  versionCount: number;
  linkCount: number;
  content: ReactNode;
  versions: ReactNode;
  links: ReactNode;
  /** *Compartir*: the portal links that include the document (PRD §8.9.5), wired from the shares feature. */
  shares: ReactNode;
  notes: ReactNode;
  /** `null` for a role that cannot read the activity log: the tab is left out. */
  activity: ReactNode | null;
}

/**
 * The tabs of `/documents/[id]` (PRD §8.9.5 "Detalle"), in the PRD's order: Contenido, Versiones, Vínculos, Compartir,
 * Notas, Actividad and Grafo, chosen by `?tab=`. The graph itself belongs to H1-B5 (A1): its tab points there.
 */
export function DocumentDetailTabs({
  documentId,
  versionCount,
  linkCount,
  content,
  versions,
  links,
  shares,
  notes,
  activity,
}: DocumentDetailTabsProps) {
  const t = useTranslations("documents.detail");
  const tabs: DetailTab[] = [
    { value: "content", label: t("tabs.content"), content },
    { value: "versions", label: t("tabs.versions"), count: versionCount, content: versions },
    { value: "links", label: t("tabs.links"), count: linkCount, content: links },
    { value: "shares", label: t("tabs.shares"), content: shares },
    { value: "notes", label: t("tabs.notes"), content: notes },
    ...(activity === null
      ? []
      : [{ value: "activity", label: t("tabs.activity"), content: activity }]),
    {
      value: "graph",
      label: t("tabs.graph"),
      content: (
        <EmptyState
          icon={Network}
          title={t("graph.title")}
          description={t("graph.description")}
          action={
            <Button asChild variant="outline">
              <Link href={`/documents/${encodeURIComponent(documentId)}/graph`}>
                {t("graph.open")}
              </Link>
            </Button>
          }
        />
      ),
    },
  ];
  return <DetailTabs tabs={tabs} defaultTab="content" />;
}
