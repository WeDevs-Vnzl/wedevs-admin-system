"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2OffIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import type { DocumentLinkTarget } from "@/lib/validators/documents";
import { unlinkDocumentAction } from "../actions";

interface DocumentRowActionsProps {
  documentId: string;
  documentTitle: string;
  /** The link to remove: the record the tab belongs to. The document's other links stay (HU-20 CA2). */
  target: DocumentLinkTarget;
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
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${t("trigger")}: ${documentTitle}`}
        onClick={() => setOpen(true)}
      >
        <Link2OffIcon aria-hidden="true" />
        {t("trigger")}
      </Button>
      <ConfirmDialog
        variant="unlink"
        open={open}
        onOpenChange={setOpen}
        description={t("description", { name: documentTitle })}
        pending={pending}
        onConfirm={unlink}
      />
    </>
  );
}
