"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";
import { archiveProjectAction, archiveProjectsAction } from "@/features/projects/actions";

interface ProjectArchiveDialogProps {
  /** The project (detail header) or the selected projects (table bulk action). */
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already translated copy of the first step (a record name, the bulk count). */
  description: string;
  /** Called after the archive succeeds, so the caller reloads or navigates. */
  onArchived: () => void;
}

/**
 * Archive confirmation of one or more projects (C19). The first request goes without `confirm`, so the
 * service's active-billing guard runs; on `INTEGRITY_LOCK` the dialog stays open with
 * `projects.errors.archiveNeedsConfirm` and its button re-sends with `confirm: true`. Focus returns to the
 * opener on close (W2 T1).
 */
export function ProjectArchiveDialog({
  ids,
  open,
  onOpenChange,
  description,
  onArchived,
}: ProjectArchiveDialogProps) {
  const t = useTranslations("projects");
  const tErrors = useTranslations("common.errors");
  const [pending, setPending] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  useOpenerFocus(open);

  // Each opening starts at the first step, whatever the last attempt left.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setNeedsConfirm(false);
  }

  async function archive() {
    setPending(true);
    const confirm = needsConfirm;
    const [first] = ids;
    const result =
      ids.length === 1 && first
        ? await archiveProjectAction({ id: first, confirm })
        : await archiveProjectsAction({ ids, confirm });
    setPending(false);
    if (!result.ok) {
      if (result.error.code === "INTEGRITY_LOCK" && !confirm) {
        setNeedsConfirm(true);
        return;
      }
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(
      ids.length === 1 ? t("toast.archived") : t("toast.bulkArchived", { count: ids.length }),
    );
    onOpenChange(false);
    onArchived();
  }

  return (
    <ConfirmDialog
      variant="archive"
      open={open}
      onOpenChange={onOpenChange}
      description={needsConfirm ? t("errors.archiveNeedsConfirm") : description}
      pending={pending}
      onConfirm={() => void archive()}
    />
  );
}
