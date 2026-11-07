"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { createPaymentLinkAction } from "@/features/invoices/payment-link-actions";
import { isDecimalString, isZeroMoney } from "@/lib/money";
import { useActionErrorMessage } from "./use-action-error";

type PaymentLinksCreateDialogProps = {
  invoiceId: string;
  currency: string;
  capacity: string;
  disabled: boolean;
};

type FormProps = Omit<PaymentLinksCreateDialogProps, "disabled"> & { onDone: () => void };

function CreateLinkForm({ invoiceId, currency, capacity, onDone }: FormProps) {
  const t = useTranslations("invoices.paymentLinks");
  const tRoot = useTranslations();
  const errorMessage = useActionErrorMessage();
  const router = useRouter();
  // One id per opening (DT-196): every retry inside the dialog reuses it, the next opening makes a new one. It is
  // never persisted. The form unmounts with the dialog content, so state is fresh on every open.
  const [requestId] = useState(() => crypto.randomUUID());
  // The proposal is the capacity; what is sent is the value the user sees and can edit (rule 22).
  const [amount, setAmount] = useState(capacity);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSubmit = isDecimalString(amount) && !isZeroMoney(amount) && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldError(null);
    setFormError(null);
    const result = await createPaymentLinkAction({ invoiceId, amount, requestId });
    setSaving(false);
    if (!result.ok) {
      const key = result.error.fieldErrors?.amount?.[0];
      if (key) setFieldError(tRoot.has(key as never) ? tRoot(key as never) : errorMessage(result.error));
      else setFormError(errorMessage(result.error));
      return;
    }
    toast.success(t("toast.created"));
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("dialog.title")}</DialogTitle>
        <DialogDescription>{t("dialog.description")}</DialogDescription>
      </DialogHeader>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <Field data-invalid={fieldError ? true : undefined}>
        <FieldLabel htmlFor="payment-link-amount">{t("dialog.amount")}</FieldLabel>
        <MoneyInput
          id="payment-link-amount"
          value={{ amount, currency }}
          onChange={(value) => setAmount(value.amount)}
          currencies={[{ code: currency }]}
          currencyDisabled
          aria-invalid={fieldError ? true : undefined}
        />
        <FieldError>{fieldError}</FieldError>
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("dialog.cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit} className="active:scale-[0.96]">
          {saving ? t("dialog.submitting") : t("dialog.submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Crear enlace": the dialog with the amount (prefilled with the capacity) and the invoice currency fixed. */
export function PaymentLinksCreateDialog({
  invoiceId,
  currency,
  capacity,
  disabled,
}: PaymentLinksCreateDialogProps) {
  const t = useTranslations("invoices.paymentLinks");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={disabled} className="transition-transform active:scale-[0.96]">
          {t("create")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain">
        <CreateLinkForm
          invoiceId={invoiceId}
          currency={currency}
          capacity={capacity}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
