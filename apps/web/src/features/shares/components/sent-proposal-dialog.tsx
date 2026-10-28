"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DocumentStatus } from "@/lib/validators/enums";
import { markDocumentsSentAction } from "../actions";

export interface SentProposalDocument {
  id: string;
  code?: string;
  title: string;
  status: DocumentStatus;
}

interface SentProposalDialogProps {
  /** The documents just shared; only the `APROBADO` ones are proposed. */
  documents: readonly SentProposalDocument[] | null;
  /** Called once the user answered (moved or not now). */
  onDone: () => void;
}

/**
 * "Compartir un documento en el portal propone pasarlo a `ENVIADO` si estaba `APROBADO`" (PRD §8.9.4). Asked once per
 * share (A5): every `APROBADO` document with one checkbox, all checked; only the checked ones move.
 */
export function SentProposalDialog({ documents, onDone }: SentProposalDialogProps) {
  const t = useTranslations("shares.sentProposal");
  const approved = (documents ?? []).filter((doc) => doc.status === "APROBADO");
  const open = approved.length > 0;
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const checked = approved.filter((doc) => !unchecked.has(doc.id)).map((doc) => doc.id);

  function finish() {
    setUnchecked(new Set());
    onDone();
  }

  function toggle(id: string, on: boolean) {
    setUnchecked((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirm() {
    if (checked.length === 0) return;
    startTransition(async () => {
      const result = await markDocumentsSentAction({ documentIds: checked });
      if (!result.ok) toast.error(t("failed"));
      else if (result.data.sent.length < checked.length) toast.error(t("partial"));
      else toast.success(t("done", { count: result.data.sent.length }));
      finish();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : finish())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-2">
          {approved.map((doc) => {
            const id = `sent-proposal-${doc.id}`;
            return (
              <li key={doc.id} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={!unchecked.has(doc.id)}
                  onCheckedChange={(value) => toggle(doc.id, value === true)}
                  disabled={pending}
                />
                <Label htmlFor={id} className="font-normal">
                  {doc.title}
                </Label>
                {doc.code ? (
                  <span className="font-mono text-xs text-muted-foreground">{doc.code}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("skip")}</AlertDialogCancel>
          <Button type="button" onClick={confirm} disabled={pending || checked.length === 0}>
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
