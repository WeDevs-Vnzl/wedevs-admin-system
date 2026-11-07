"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { allocatePaymentAction, listOpenInvoicesAction } from "@/features/payments/actions";
import type { ActionError } from "@/lib/validators/common";
import type { OpenInvoiceOption } from "../types";
import {
  AllocationRows,
  isPositiveAmount,
  shownInvoiceAmount,
  type AppliedRow,
} from "./allocation-rows";
import { useErrorText } from "./use-error-text";

/** What the sheet needs of the payment it allocates (a view of `PaymentResponseDto`). */
export type AllocatablePayment = {
  id: string;
  clientId: string;
  currency: string;
  usdRate: string;
  /** Credit left on the payment, as the BE computed it. */
  unallocated: string;
};

type AllocatePaymentSheetProps = {
  payment: AllocatablePayment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Asignar" (PRD §8.6 "se puede aplicar después", HU-13 CA5): the client's open invoices with the same per-row
 * amounts as the form (rule 22). Each ticked row becomes one `POST /payments/{id}/allocations`; the page then
 * refreshes from the BE, whose settlement (DT-199, DT-202) is the rule. The list scrolls inside the sheet.
 */
export function AllocatePaymentSheet({ payment, open, onOpenChange }: AllocatePaymentSheetProps) {
  const t = useTranslations("payments");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("allocate.title")}</SheetTitle>
          <SheetDescription>{t("allocate.description")}</SheetDescription>
        </SheetHeader>
        <AllocateBody payment={payment} onOpenChange={onOpenChange} />
      </SheetContent>
    </Sheet>
  );
}

// The body mounts when the sheet opens and unmounts on close, so every opening starts clean and reads the open
// invoices again.
function AllocateBody({
  payment,
  onOpenChange,
}: {
  payment: AllocatablePayment;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("payments");
  const tForm = useTranslations("payments.form");
  const tRoot = useTranslations();
  const router = useRouter();
  const errorText = useErrorText();
  const [invoices, setInvoices] = useState<OpenInvoiceOption[] | null>(null);
  const [applied, setApplied] = useState<Record<string, AppliedRow>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [sectionError, setSectionError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const { clientId } = payment;
  useEffect(() => {
    let cancelled = false;
    void listOpenInvoicesAction({ clientId }).then((result) => {
      if (!cancelled) setInvoices(result.ok ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  function setRow(invoiceId: string, patch: Partial<AppliedRow>) {
    setRowErrors((current) => {
      const next = { ...current };
      delete next[invoiceId];
      return next;
    });
    setSectionError(undefined);
    setApplied((current) => ({
      ...current,
      [invoiceId]: { selected: false, amountPayment: "", ...current[invoiceId], ...patch },
    }));
  }

  const ticked = (invoices ?? []).filter((invoice) => applied[invoice.id]?.selected);
  const ready =
    ticked.length > 0 &&
    ticked.every((invoice) => isPositiveAmount(applied[invoice.id]?.amountPayment ?? ""));

  /** The BE's refusal of one row: its field error at the row, anything about the payment itself on the sheet. */
  function showError(error: ActionError, invoiceId: string) {
    let onRow = false;
    for (const [path, messages] of Object.entries(error.fieldErrors ?? {})) {
      const message = messages[0];
      if (!message) continue;
      if (path.startsWith("allocations.")) {
        setRowErrors((current) => ({ ...current, [invoiceId]: message }));
        onRow = true;
      } else {
        setSectionError(message);
        onRow = true;
      }
    }
    if (!onRow) setSectionError(error.message);
    toast.error(errorText(error));
  }

  async function onAllocate() {
    const missing: Record<string, string> = {};
    for (const invoice of ticked) {
      const row = applied[invoice.id];
      const shown = shownInvoiceAmount(row, invoice, payment.currency, payment.usdRate);
      if (!isPositiveAmount(shown))
        missing[invoice.id] = "payments.validation.allocationAmountRequired";
    }
    if (Object.keys(missing).length > 0) {
      setRowErrors(missing);
      return;
    }

    setSaving(true);
    let allocated = 0;
    for (const invoice of ticked) {
      const row = applied[invoice.id];
      if (!row) continue;
      const result = await allocatePaymentAction({
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountPaymentCurrency: row.amountPayment,
        // The value the invoice-currency field shows, edited or proposed (rule 22).
        amountInvoiceCurrency: shownInvoiceAmount(row, invoice, payment.currency, payment.usdRate),
      });
      if (!result.ok) {
        setSaving(false);
        showError(result.error, invoice.id);
        if (allocated > 0) router.refresh();
        return;
      }
      allocated += 1;
      // Done rows leave the list: allocating the same invoice again would be a duplicate.
      setInvoices((current) => current?.filter((item) => item.id !== invoice.id) ?? current);
    }
    setSaving(false);
    toast.success(t("toast.allocated"));
    router.refresh();
    onOpenChange(false);
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4">
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="text-xs text-muted-foreground">{tForm("fields.unallocated")}</span>
          <MoneyText
            amount={payment.unallocated}
            currency={payment.currency}
            className="tabular-nums"
          />
        </div>
        {invoices === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("allocate.loading")}
          </p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tForm("fields.noOpenInvoices")}</p>
        ) : (
          <AllocationRows
            openInvoices={invoices}
            applied={applied}
            currency={payment.currency}
            usdRate={payment.usdRate}
            errors={rowErrors}
            onRowChange={setRow}
            idPrefix="sheet-alloc"
          />
        )}
        {sectionError ? (
          <p role="alert" className="text-sm text-destructive">
            {tRoot(sectionError as never)}
          </p>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          {tRoot("common.actions.cancel")}
        </Button>
        <Button
          className="transition-transform active:scale-[0.96]"
          disabled={!ready || saving}
          onClick={() => void onAllocate()}
        >
          {t("allocate.submit")}
        </Button>
      </SheetFooter>
    </>
  );
}
