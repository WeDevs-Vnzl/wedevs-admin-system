"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2OffIcon } from "lucide-react";
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
import type { DocumentLinkEntityType } from "@/lib/validators/documents";
import { unlinkDocumentAction } from "../actions";

interface DocumentRowActionsProps {
  documentId: string;
  documentTitle: string;
  /** The link to remove: the record the tab belongs to. The document's other links stay (HU-20 CA2). */
  target: { entityType: DocumentLinkEntityType; entityId: string };
}

/**
 * Per-row action of the Documentos tab: unlinks the document from this record behind a confirmation.
 * Only rendered for roles with `update` on documents (the action checks it again).
 */
export function DocumentRowActions({ documentId, documentTitle, target }: DocumentRowActionsProps) {
  const t = useTranslations("documents.tab.unlink");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function unlink() {
    startTransition(async () => {
      const result = await unlinkDocumentAction({ documentId, target });
      if (!result.ok) {
        toast.error(t("failed"));
        return;
      }
      setOpen(false);
      toast.success(t("done"));
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${t("trigger")}: ${documentTitle}`}>
          <Link2OffIcon aria-hidden="true" />
          {t("trigger")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              unlink();
            }}
            disabled={pending}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
