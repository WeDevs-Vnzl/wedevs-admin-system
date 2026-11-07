"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deactivatePaymentLinkAction } from "@/features/invoices/payment-link-actions";
import { useActionErrorMessage } from "./use-action-error";

/** Deactivates a `PENDING` / `ACTIVE` link after a confirmation; the list then refreshes from the BE. */
export function PaymentLinksDeactivate({ invoiceId, linkId }: { invoiceId: string; linkId: string }) {
  const t = useTranslations("invoices.paymentLinks");
  const errorMessage = useActionErrorMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onConfirm() {
    setSaving(true);
    const result = await deactivatePaymentLinkAction({ invoiceId, linkId });
    setSaving(false);
    if (!result.ok) {
      toast.error(errorMessage(result.error));
      return;
    }
    toast.success(t("toast.deactivated"));
    setOpen(false);
    router.refresh();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {t("deactivate")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="data-closed:duration-100">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deactivateDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deactivateDialog.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deactivateDialog.cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={saving} onClick={() => void onConfirm()}>
            {t("deactivateDialog.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
