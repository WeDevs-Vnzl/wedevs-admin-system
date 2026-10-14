"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { SectionCard } from "@/components/patterns/section-card";
import { reorderProjectLinksAction } from "@/features/projects/actions";
import type { ProjectLinkDTO } from "@/lib/validators/projects";
import { LINK_GROUPS, linkRowsFromDto, orderedIdsOf, type ProjectLinkRow } from "../link-rows";
import { ProjectLinksEditor } from "./project-links-editor";

export interface ProjectLinksPanelProps {
  projectId: string;
  links: readonly ProjectLinkDTO[];
  /** Owner, Admin and Member may reorder; Viewer reads only. */
  canReorder: boolean;
}

/**
 * The *Enlaces* tab of the project detail: the grouped links, reordered by drag or keyboard. Each group whose
 * order changed is persisted through `reorderProjectLinksAction` (HU-07 CA2); a failed save restores the
 * previous order.
 */
export function ProjectLinksPanel({ projectId, links, canReorder }: ProjectLinksPanelProps) {
  const t = useTranslations("projects.toast");
  const tTabs = useTranslations("projects.detail.tabs");
  const router = useRouter();
  const [rows, setRows] = useState<ProjectLinkRow[]>(() => linkRowsFromDto(links));

  async function onChange(next: ProjectLinkRow[]) {
    const previous = rows;
    setRows(next);
    for (const group of LINK_GROUPS) {
      const before = orderedIdsOf(previous, group);
      const after = orderedIdsOf(next, group);
      if (before.join() === after.join()) continue;
      const result = await reorderProjectLinksAction({
        projectId,
        group,
        orderedLinkIds: after,
      });
      if (!result.ok) {
        setRows(previous);
        toast.error(t("orderFailed"));
        return;
      }
    }
    toast.success(t("linksReordered"));
    router.refresh();
  }

  return (
    <SectionCard heading title={tTabs("links")}>
      <ProjectLinksEditor rows={rows} onChange={onChange} reorderable={canReorder} />
    </SectionCard>
  );
}
