"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { archiveClientsAction } from "@/features/clients/actions";
import { useOpenerFocus } from "./use-opener-focus";

type ClientArchiveDialogProps = {
  /** The client (detail page) or the selected clients (table bulk action). */
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the archive succeeds, so the caller reloads its rows. */
  onArchived: () => void;
};

/**
 * Archive confirmation of one or more clients (C19, §7.7). The first request goes without `confirm`, so the
 * service's integrity lock runs (active projects or open invoices); on `INTEGRITY_LOCK` the dialog stays open
 * with `clients.errors.archiveNeedsConfirm` and its button re-sends with `confirm: true`.
 */
export function ClientArchiveDialog({
  ids,
  open,
  onOpenChange,
  onArchived,
}: ClientArchiveDialogProps) {
  const t = useTranslations("clients");
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

  async function confirm() {
    setPending(true);
    const confirmed = needsConfirm;
    const result = await archiveClientsAction({ ids, confirm: confirmed });
    setPending(false);
    if (!result.ok) {
      if (result.error.code === "INTEGRITY_LOCK" && !confirmed) {
        setNeedsConfirm(true);
        return;
      }
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.archivedMany", { count: result.data.archived.length }));
    onOpenChange(false);
    onArchived();
  }

  return (
    <ConfirmDialog
      variant="archive"
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={() => void confirm()}
      pending={pending}
      description={
        needsConfirm
          ? t("errors.archiveNeedsConfirm")
          : ids.length > 1
            ? t("archive.cascadeMany")
            : t("archive.cascade")
      }
    />
  );
}
