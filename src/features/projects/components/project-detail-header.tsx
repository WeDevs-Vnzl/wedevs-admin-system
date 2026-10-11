"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArchivedBanner } from "@/components/patterns/archived-banner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DetailHeader } from "@/components/patterns/detail-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TagChips } from "@/features/tags/components/tag-chips";
import { archiveProjectAction } from "@/features/projects/actions";
import type { ProjectStatus } from "@/lib/validators/enums";
import { PROJECT_STATUS_TRANSITIONS } from "@/lib/validators/projects";
import type { TagChipDTO } from "@/lib/validators/tags";
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
  const tRoot = useTranslations();
  const router = useRouter();
  const headerRef = useRef<HTMLDivElement>(null);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const canChangeStatus = canEdit && PROJECT_STATUS_TRANSITIONS[status].length > 0;

  async function archive() {
    const result = await archiveProjectAction({ id, confirm: true });
    if (!result.ok) {
      toast.error(tRoot(`common.errors.${result.error.code}` as never));
      return;
    }
    toast.success(t("toast.archived"));
    setArchiveOpen(false);
    router.push("/projects/list");
    router.refresh();
  }

  /** Focus goes back to the More trigger when the archive dialog closes (its opener is the menu item). */
  function onArchiveOpenChange(open: boolean) {
    setArchiveOpen(open);
    if (!open) headerRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
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
              {t("detail.startDate")}: {startDate ?? t("detail.notSet")} · {t("detail.endDate")}:{" "}
              {endDate ?? t("detail.notSet")}
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

      <ConfirmDialog
        variant="archive"
        open={archiveOpen}
        onOpenChange={onArchiveOpenChange}
        description={t("detail.archiveDescription", { name })}
        onConfirm={() => void archive()}
      />
    </div>
  );
}
