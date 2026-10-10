"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ConfirmVariant = "archive" | "void" | "cancel";

export type ConfirmResult = { reason?: string; extraChecked?: boolean };

type ConfirmDialogProps = {
  variant: ConfirmVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: ConfirmResult) => void;
  // Asks for a reason; confirm stays disabled until it is not blank.
  requireReason?: boolean;
  // Optional extra checkbox label (e.g. "También anular las facturas emitidas").
  extraCheckboxLabel?: string;
  pending?: boolean;
};

// Archive / void / cancel confirmation (frontend-patterns §4). Destructive copy comes from patterns.
export function ConfirmDialog({
  variant,
  open,
  onOpenChange,
  onConfirm,
  requireReason = false,
  extraCheckboxLabel,
  pending = false,
}: ConfirmDialogProps) {
  const t = useTranslations("patterns.confirm");
  const [reason, setReason] = useState("");
  const [extraChecked, setExtraChecked] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const baseId = useId();
  const reasonId = `${baseId}-reason`;
  const reasonErrorId = `${baseId}-reason-error`;
  const extraId = `${baseId}-extra`;

  // Each time the dialog opens it starts clean, whatever the parent left typed or checked last time.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason("");
      setExtraChecked(false);
    }
  }

  const reasonMissing = requireReason && reason.trim().length === 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`variants.${variant}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`variants.${variant}.description`)}</AlertDialogDescription>
        </AlertDialogHeader>

        {requireReason ? (
          <div className="grid gap-2">
            <Label htmlFor={reasonId}>{t("reason")}</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={reasonMissing || undefined}
              aria-describedby={reasonMissing ? reasonErrorId : undefined}
            />
            {reasonMissing ? (
              <p id={reasonErrorId} className="text-destructive text-xs">
                {t("reasonRequired")}
              </p>
            ) : null}
          </div>
        ) : null}

        {extraCheckboxLabel ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={extraId}
              checked={extraChecked}
              onCheckedChange={(checked) => setExtraChecked(checked === true)}
            />
            <Label htmlFor={extraId}>{extraCheckboxLabel}</Label>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("dismiss")}</AlertDialogCancel>
          <AlertDialogAction
            variant={variant === "cancel" ? "outline" : "destructive"}
            disabled={pending || reasonMissing}
            onClick={(event) => {
              event.preventDefault();
              onConfirm({
                reason: requireReason ? reason.trim() : undefined,
                extraChecked: extraCheckboxLabel ? extraChecked : undefined,
              });
            }}
          >
            {t(`variants.${variant}.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
