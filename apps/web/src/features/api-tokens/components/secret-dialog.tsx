"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type SecretDialogProps = {
  /** The full token, or `null` when there is nothing to show. The parent drops it on close. */
  secret: string | null;
  onClose: () => void;
};

const COPIED_FEEDBACK_MS = 2000;

// The one place a token secret is rendered (DT-189). It lives only in the parent's state while this dialog is
// open: never in a URL, a toast, a log or storage. Outside clicks do not dismiss it, so it is not lost by accident.
export function SecretDialog({ secret, onClose }: SecretDialogProps) {
  const t = useTranslations("apiTokens");
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      toast.error(t("toast.copyFailed"));
    }
  }

  return (
    <Dialog
      open={secret !== null}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto overscroll-contain"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("secret.title")}</DialogTitle>
          <DialogDescription>{t("secret.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor="api-token-secret">{t("secret.label")}</Label>
          <div className="flex items-start gap-2">
            <code
              id="api-token-secret"
              className="min-w-0 flex-1 rounded-md bg-muted p-3 font-mono text-sm break-all select-all"
            >
              {secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copy}
              aria-label={copied ? t("actions.copied") : t("actions.copy")}
            >
              <span className="relative size-4">
                <Copy
                  aria-hidden
                  className={`absolute inset-0 size-4 transition-[opacity,scale] duration-150 motion-reduce:transition-none ${copied ? "scale-50 opacity-0" : "scale-100 opacity-100"}`}
                />
                <Check
                  aria-hidden
                  className={`absolute inset-0 size-4 transition-[opacity,scale] duration-150 motion-reduce:transition-none ${copied ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
                />
              </span>
            </Button>
          </div>
          <p role="status" className="sr-only">
            {copied ? t("actions.copied") : ""}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t("secret.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
