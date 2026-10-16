"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { restoreDocumentVersionAction } from "../actions";

export interface DocumentVersionRestoreButtonProps {
  documentId: string;
  versionId: string;
  versionNumber: number;
  /** `icon` in the history rows; `text` on the version page. */
  appearance?: "icon" | "text";
  /** Where to go once restored (the version page sends the reader back to the document); refreshes otherwise. */
  redirectTo?: string;
}

/**
 * "Restaurar" (PRD §8.9.3): after confirmation, a new current version N+1 copying the chosen one. The history is
 * never rewritten; a `FIRMADO` document refuses it (`INTEGRITY_LOCK`), which the caller avoids by not rendering it.
 */
export function DocumentVersionRestoreButton({
  documentId,
  versionId,
  versionNumber,
  appearance = "icon",
  redirectTo,
}: DocumentVersionRestoreButtonProps) {
  const t = useTranslations("documents.versions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const number = versionNumber;

  function restore() {
    startTransition(async () => {
      const result = await restoreDocumentVersionAction({ documentId, versionId });
      setOpen(false);
      if (!result.ok) {
        toast.error(t("restoreFailed"));
        return;
      }
      toast.success(t("restored"));
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        {appearance === "icon" ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("restore", { number })}>
            <RotateCcw aria-hidden />
          </Button>
        ) : (
          <Button variant="outline">
            <RotateCcw aria-hidden />
            {t("restore", { number })}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("restoreTitle", { number })}</AlertDialogTitle>
          <AlertDialogDescription>{t("restoreDescription", { number })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("restoreCancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              // The dialog stays open until the action answers.
              event.preventDefault();
              restore();
            }}
          >
            {t("restoreConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
