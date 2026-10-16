"use client";

import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { OneTimeAccessKey } from "../types";
import { copyToClipboard } from "./copy-to-clipboard";

interface OneTimeKeysDialogProps {
  /** The clear keys of this one response; `null` or empty renders nothing. */
  keys: readonly OneTimeAccessKey[] | null;
  /** Called when the dialog closes. The caller drops the keys: they are never shown again (DT-45). */
  onClose: () => void;
}

/**
 * Shows freshly generated access keys once, with a copy button each. The keys live only in the caller's state until
 * this dialog closes; nothing is persisted, logged or re-read later (no read DTO carries a key).
 */
export function OneTimeKeysDialog({ keys, onClose }: OneTimeKeysDialogProps) {
  const t = useTranslations("shares.oneTimeKeys");
  const open = Boolean(keys && keys.length > 0);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        className="sm:max-w-lg"
        // Closing by a stray click outside would lose the keys for good.
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {(keys ?? []).map((key) => {
            const id = `one-time-key-${key.documentId}`;
            return (
              <li key={key.documentId} className="flex flex-col gap-1.5">
                <label htmlFor={id} className="text-sm font-medium">
                  {t("keyLabel", { title: key.documentTitle })}
                </label>
                <div className="flex gap-2">
                  <Input
                    id={id}
                    readOnly
                    value={key.accessKey}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("copy", { title: key.documentTitle })}
                    onClick={() =>
                      void copyToClipboard(key.accessKey, {
                        ok: t("copied"),
                        failed: t("copyFailed"),
                      })
                    }
                  >
                    <Copy aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t("done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
