"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  setDocumentStatusInputSchema,
  type UserSettableDocumentStatus,
} from "@/lib/validators/documents";
import type { DocumentStatus } from "@/lib/validators/enums";
import { setDocumentStatusAction } from "../actions";
import { allowedDocumentStatuses } from "./document-status-transitions";

type FieldName = "status" | "signedAt";
type Errors = Partial<Record<FieldName, string>>;

export interface DocumentStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: { id: string; status: DocumentStatus; requiresSignature: boolean };
}

/** Field errors of a failed parse or action, keyed by the two fields the dialog shows. */
function pickErrors(fieldErrors: Record<string, string[] | undefined>): Errors {
  const errors: Errors = {};
  for (const name of ["status", "signedAt"] as const) {
    const message = fieldErrors[name]?.[0];
    if (message) errors[name] = message;
  }
  return errors;
}

/**
 * "Cambiar estado" (PRD §8.9.4, S6): only the transitions allowed from the current status, `FIRMADO` only on types
 * with signature, and the signature date required when `FIRMADO` is chosen. The server checks the same rules again;
 * its field errors (e.g. `documents.errors.invalidTransition`) land on the fields.
 */
export function DocumentStatusDialog({ open, onOpenChange, document }: DocumentStatusDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const baseId = useId();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<UserSettableDocumentStatus | "">("");
  const [signedAt, setSignedAt] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts clean.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStatus("");
      setSignedAt("");
      setErrors({});
    }
  }

  const options = allowedDocumentStatuses(document.status, document.requiresSignature);
  const translate = (message: string | undefined) =>
    message ? (t.has(message) ? t(message) : message) : undefined;
  const statusError = translate(errors.status);
  const signedAtError = translate(errors.signedAt);
  const statusErrorId = `${baseId}-status-error`;
  const signedAtId = `${baseId}-signed-at`;
  const signedAtHintId = `${baseId}-signed-at-hint`;
  const signedAtErrorId = `${baseId}-signed-at-error`;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = {
      id: document.id,
      status,
      ...(status === "FIRMADO" && signedAt ? { signedAt } : {}),
    };
    const parsed = setDocumentStatusInputSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? "status");
        (fieldErrors[name] ??= []).push(issue.message);
      }
      setErrors(pickErrors(fieldErrors));
      return;
    }
    startTransition(async () => {
      const result = await setDocumentStatusAction(parsed.data);
      if (!result.ok) {
        const fieldErrors = pickErrors(result.error.fieldErrors ?? {});
        setErrors(fieldErrors);
        if (!fieldErrors.status && !fieldErrors.signedAt) {
          toast.error(
            t.has(result.error.message) ? t(result.error.message) : t("documents.status.failed"),
          );
        }
        return;
      }
      toast.success(t("documents.status.done"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("documents.status.title")}</DialogTitle>
            <DialogDescription>
              {t("documents.status.description", {
                status: t(`enums.DocumentStatus.${document.status}`),
              })}
            </DialogDescription>
          </DialogHeader>

          <FieldSet data-invalid={statusError ? true : undefined}>
            <FieldLegend variant="label">{t("documents.status.field")}</FieldLegend>
            <RadioGroup
              value={status}
              onValueChange={(value) => {
                setStatus(value as UserSettableDocumentStatus);
                setErrors({});
              }}
              aria-invalid={statusError ? true : undefined}
              aria-describedby={statusError ? statusErrorId : undefined}
            >
              {options.map((option) => (
                <div key={option} className="flex items-center gap-2">
                  <RadioGroupItem value={option} id={`${baseId}-${option}`} />
                  <Label htmlFor={`${baseId}-${option}`} className="font-normal">
                    {t(`enums.DocumentStatus.${option}`)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {statusError ? (
              <FieldError id={statusErrorId} errors={[{ message: statusError }]} />
            ) : null}
          </FieldSet>

          {status === "FIRMADO" ? (
            <Field data-invalid={signedAtError ? true : undefined}>
              <FieldLabel htmlFor={signedAtId}>{t("documents.status.signedAt")}</FieldLabel>
              <DateField
                id={signedAtId}
                value={signedAt}
                onChange={(value) => {
                  setSignedAt(value);
                  setErrors((current) => ({ ...current, signedAt: undefined }));
                }}
                placeholder={t("documents.status.placeholder")}
                aria-invalid={signedAtError ? true : undefined}
                aria-describedby={signedAtError ? signedAtErrorId : signedAtHintId}
              />
              <FieldDescription id={signedAtHintId}>
                {t("documents.status.signedAtHint")}
              </FieldDescription>
              {signedAtError ? (
                <FieldError id={signedAtErrorId} errors={[{ message: signedAtError }]} />
              ) : null}
            </Field>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("documents.status.cancel")}
            </Button>
            <Button type="submit" disabled={pending} aria-disabled={pending || undefined}>
              {t("documents.status.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
