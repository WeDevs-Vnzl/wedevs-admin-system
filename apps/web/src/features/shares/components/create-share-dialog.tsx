"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ShareLinkMutationResultDTO } from "@/lib/validators/shares";
import { createShareLinkAction } from "../actions";
import type { OneTimeAccessKey, ShareOrigin, ShareableDocument } from "../types";
import { OneTimeKeysDialog } from "./one-time-keys-dialog";
import { SentProposalDialog, type SentProposalDocument } from "./sent-proposal-dialog";
import { oneTimeKeysOf } from "./one-time-keys";
import { ShareForm, newShareFormRow } from "./share-form";

export interface CreateShareDialogProps {
  /** Where the dialog is opened from. A client origin also becomes the link's client (portal header). */
  origin: ShareOrigin;
  /**
   * Candidate documents (a document's detail: that document; a client or project: its documents), from
   * `getShareableDocuments`. More can be added from the dialog's search.
   */
  documents: readonly ShareableDocument[];
  /** Ids checked when the dialog opens; every candidate when omitted. */
  preselectedIds?: readonly string[];
  /** Replaces the default trigger button ("Share" for a document, "Share documents…" otherwise). */
  trigger?: ReactNode;
}

type Stage =
  | { name: "idle" }
  | { name: "keys"; keys: OneTimeAccessKey[]; proposal: SentProposalDocument[] }
  | { name: "proposal"; proposal: SentProposalDocument[] };

/**
 * "Compartir" (PRD §8.11 "Gestión"): creates a portal link from a document, a client or a project. After creating,
 * the access keys generated for the link are shown once (DT-45), then the `APROBADO` documents are proposed to move
 * to `ENVIADO` (PRD §8.9.4, A5).
 */
export function CreateShareDialog({
  origin,
  documents,
  preselectedIds,
  trigger,
}: CreateShareDialogProps) {
  const t = useTranslations("shares.create");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Remounts the form on every opening, so it starts from the props again.
  const [formKey, setFormKey] = useState(0);
  const [stage, setStage] = useState<Stage>({ name: "idle" });

  const preselected = new Set(preselectedIds ?? documents.map((doc) => doc.id));
  const initialRows = documents.map((doc) => newShareFormRow(doc, preselected.has(doc.id)));

  function finish() {
    setStage({ name: "idle" });
    router.refresh();
  }

  function created(result: ShareLinkMutationResultDTO) {
    setOpen(false);
    toast.success(t("created"), {
      action: {
        label: t("openLink"),
        onClick: () => router.push(`/documents/shares/${result.share.id}`),
      },
    });
    const keys = oneTimeKeysOf(result.generatedKeys, result.share.documents);
    const proposal: SentProposalDocument[] = result.share.documents
      .filter((doc) => doc.documentStatus === "APROBADO")
      .map((doc) => ({
        id: doc.document.id,
        code: doc.document.code,
        title: doc.document.label,
        status: doc.documentStatus,
      }));
    if (keys.length > 0) setStage({ name: "keys", keys, proposal });
    else if (proposal.length > 0) setStage({ name: "proposal", proposal });
    else finish();
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setFormKey((key) => key + 1);
          setOpen(next);
        }}
      >
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm">
              <Share2 aria-hidden />
              {origin.type === "DOCUMENT" ? t("trigger") : t("triggerMany")}
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description", { label: origin.label })}</DialogDescription>
          </DialogHeader>
          <ShareForm
            key={formKey}
            idPrefix="create-share"
            defaults={{ title: origin.label, message: "", locale: "es", allowDownload: true }}
            clientId={origin.type === "CLIENT" ? origin.id : undefined}
            initialRows={initialRows}
            submitLabel={t("submit")}
            onSubmit={async (input) => {
              const result = await createShareLinkAction(input);
              if (result.ok) created(result.data);
              return result;
            }}
          />
        </DialogContent>
      </Dialog>
      <OneTimeKeysDialog
        keys={stage.name === "keys" ? stage.keys : null}
        onClose={() => {
          // The keys are dropped here: only the proposal (no key) survives this step.
          if (stage.name === "keys" && stage.proposal.length > 0) {
            setStage({ name: "proposal", proposal: stage.proposal });
          } else finish();
        }}
      />
      <SentProposalDialog
        documents={stage.name === "proposal" ? stage.proposal : null}
        onDone={() => finish()}
      />
    </>
  );
}
