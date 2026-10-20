"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArchivedBanner } from "@/components/patterns/archived-banner";
import { DateText } from "@/components/patterns/date-text";
import { DetailHeader } from "@/components/patterns/detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TagChips } from "@/features/tags/components/tag-chips";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";
import type { ProjectStatus } from "@/lib/validators/enums";
import { PROJECT_STATUS_TRANSITIONS } from "@/lib/validators/projects";
import type { TagChipDTO } from "@/lib/validators/tags";
import { ProjectArchiveDialog } from "./project-archive-dialog";
import { ProjectCancelDialog, ProjectTransitionDialog } from "./project-status-dialogs";

export interface ProjectDetailHeaderProps {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  archived: boolean;
  tags: readonly TagChipDTO[];
  /** `update` on projects: Owner, Admin and Member. Viewer sees no action. */
  canEdit: boolean;
  /** `delete` on projects: Owner and Admin (archive). */
  canArchive: boolean;
}

/**
 * Header of the project detail (PRD §7.2): code, name, status, tags, "Detalle | Grafo", Editar, "Cambiar
 * estado" and the More menu (archive). Dialogs open from here and return focus to their opener on close.
 */
export function ProjectDetailHeader({
  id,
  code,
  name,
  status,
  startDate,
  endDate,
  archived,
  tags,
  canEdit,
  canArchive,
}: ProjectDetailHeaderProps) {
  const t = useTranslations("projects");
  const router = useRouter();
  const headerRef = useRef<HTMLDivElement>(null);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const canChangeStatus = canEdit && PROJECT_STATUS_TRANSITIONS[status].length > 0;

  // One opener for the status flow: the transition dialog hands over to the cancel confirmation.
  useOpenerFocus(transitionOpen || cancelOpen);

  function onArchived() {
    router.push("/projects/list");
    router.refresh();
  }

  /** Focus goes back to the More trigger when the archive dialog closes (its opener is the menu item). */
  function onArchiveOpenChange(open: boolean) {
    setArchiveOpen(open);
    // After the dialog's own focus scope has unwound, or it would take the focus back to the removed menu item.
    if (!open) {
      setTimeout(
        () => headerRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus(),
        0,
      );
    }
  }

  return (
    <div ref={headerRef} className="flex flex-col gap-4">
      <DetailHeader
        backHref="/projects/list"
        code={code}
        name={name}
        status={<StatusBadge enumName="ProjectStatus" value={status} />}
        tags={<TagChips tags={tags} />}
        meta={
          startDate || endDate ? (
            <span className="tabular-nums">
              {t("detail.startDate")}:{" "}
              {startDate ? <DateText value={startDate} /> : t("detail.notSet")} ·{" "}
              {t("detail.endDate")}: {endDate ? <DateText value={endDate} /> : t("detail.notSet")}
            </span>
          ) : null
        }
        mode="detail"
        detailHref={`/projects/${id}`}
        graphHref={`/projects/${id}/graph`}
        actions={
          canEdit ? (
            <>
              <Button variant="outline" asChild>
                <Link href={`/projects/${id}/edit`}>{t("detail.edit")}</Link>
              </Button>
              {canChangeStatus ? (
                <Button variant="outline" onClick={() => setTransitionOpen(true)}>
                  {t("detail.changeStatus")}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        moreActions={
          canArchive && !archived ? (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)} variant="destructive">
              {t("detail.archive")}
            </DropdownMenuItem>
          ) : undefined
        }
      />

      {archived ? <ArchivedBanner /> : null}

      {canChangeStatus ? (
        <ProjectTransitionDialog
          open={transitionOpen}
          onOpenChange={setTransitionOpen}
          project={{ id, status, startDate, endDate }}
          onRequestCancel={() => setCancelOpen(true)}
        />
      ) : null}

      <ProjectCancelDialog open={cancelOpen} onOpenChange={setCancelOpen} projectId={id} />

      <ProjectArchiveDialog
        ids={[id]}
        open={archiveOpen}
        onOpenChange={onArchiveOpenChange}
        description={t("detail.archiveDescription", { name })}
        onArchived={onArchived}
      />
    </div>
  );
}
