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

export type ConfirmVariant = "archive" | "void" | "cancel" | "delete" | "unlink";

export type ConfirmOption = { id: string; label: string };

export type ConfirmResult = {
  reason?: string;
  extraChecked?: boolean;
  // Present only when the dialog was given `options`: one entry per option id.
  options?: Record<string, boolean>;
};

type ConfirmDialogProps = {
  variant: ConfirmVariant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: ConfirmResult) => void;
  // Asks for a reason; confirm stays disabled until it is not blank.
  requireReason?: boolean;
  // Optional extra checkbox label (e.g. "También anular las facturas emitidas").
  extraCheckboxLabel?: string;
  // Already translated copy that replaces the variant description (a record name, a cascade warning).
  description?: string;
  // Checkboxes, all unchecked at each opening; the result carries one boolean per id.
  options?: ConfirmOption[];
  pending?: boolean;
};

// Archive / void / cancel / delete / unlink confirmation (frontend-patterns §4). Destructive copy comes from patterns.
export function ConfirmDialog({
  variant,
  open,
  onOpenChange,
  onConfirm,
  requireReason = false,
  extraCheckboxLabel,
  description,
  options,
  pending = false,
}: ConfirmDialogProps) {
  const t = useTranslations("patterns.confirm");
  const [reason, setReason] = useState("");
  const [extraChecked, setExtraChecked] = useState(false);
  const [optionChecked, setOptionChecked] = useState<Record<string, boolean>>({});
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
      setOptionChecked({});
    }
  }

  const reasonMissing = requireReason && reason.trim().length === 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`variants.${variant}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? t(`variants.${variant}.description`)}
          </AlertDialogDescription>
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
              <p id={reasonErrorId} className="text-xs text-destructive">
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

        {options?.map((option) => {
          const optionId = `${baseId}-option-${option.id}`;
          return (
            <div key={option.id} className="flex items-center gap-2">
              <Checkbox
                id={optionId}
                checked={optionChecked[option.id] === true}
                onCheckedChange={(checked) =>
                  setOptionChecked((current) => ({ ...current, [option.id]: checked === true }))
                }
              />
              <Label htmlFor={optionId}>{option.label}</Label>
            </div>
          );
        })}

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
                ...(options
                  ? {
                      options: Object.fromEntries(
                        options.map((option) => [option.id, optionChecked[option.id] === true]),
                      ),
                    }
                  : {}),
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
