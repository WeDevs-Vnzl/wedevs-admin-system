"use client";

import { useState } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { voidInvoiceAction } from "@/features/invoices/actions";

type VoidInvoiceDialogProps = {
  invoiceId: string;
  invoiceNumber: string;
};

/**
 * Annuls an invoice (HU-12 CA5). The reason is mandatory; the service refuses the void while payments still
 * allocate to the invoice, and the toast says so.
 */
export function VoidInvoiceDialog({ invoiceId, invoiceNumber }: VoidInvoiceDialogProps) {
  const t = useTranslations("invoices");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function onConfirm() {
    setSaving(true);
    const result = await voidInvoiceAction({ id: invoiceId, reason: reason.trim() });
    setSaving(false);
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.voided"));
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t("detail.actions.void")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("void.title", { number: invoiceNumber })}</DialogTitle>
          <DialogDescription>{t("void.description")}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="void-reason">{t("void.reasonLabel")}</FieldLabel>
          <Textarea
            id="void-reason"
            rows={3}
            value={reason}
            placeholder={t("void.reasonPlaceholder")}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tActions("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={saving || reason.trim().length === 0}
            onClick={() => void onConfirm()}
          >
            {t("void.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
