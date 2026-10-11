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
 * Archive confirmation of one or more clients (C19, §7.7). The client cascade archives its contacts, so the
 * dialog says so in its description and the action always sends `confirm: true`: the user has confirmed.
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
  useOpenerFocus(open);

  async function confirm() {
    setPending(true);
    const result = await archiveClientsAction({ ids, confirm: true });
    setPending(false);
    if (!result.ok) {
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
      description={ids.length > 1 ? t("archive.cascadeMany") : t("archive.cascade")}
    />
  );
}
