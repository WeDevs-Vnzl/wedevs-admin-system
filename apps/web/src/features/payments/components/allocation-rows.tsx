"use client";

import { useTranslations } from "next-intl";
import { MoneyText } from "@/components/patterns/money-text";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { proposeAllocation } from "@/lib/finance";
import { compareMoney, isDecimalString } from "@/lib/money";
import type { OpenInvoiceOption } from "../types";

/** State of one invoice row. `invoiceAmount` is set only when the user edits the invoice-currency field. */
export type AppliedRow = {
  selected: boolean;
  amountPayment: string;
  invoiceAmount?: string | undefined;
};

/** Proposed amount in the invoice currency, from the payment-date rate (HU-13 CA4), or `null` when not computable. */
export function proposeInvoiceAmount(
  amountPayment: string,
  paymentCurrency: string,
  paymentUsdRate: string,
  invoice: OpenInvoiceOption,
): string | null {
  if (!isDecimalString(amountPayment) || compareMoney(amountPayment, "0") <= 0) return null;
  if (!isDecimalString(paymentUsdRate) || compareMoney(paymentUsdRate, "0") <= 0) return null;
  return proposeAllocation({
    amountPaymentCurrency: amountPayment,
    paymentCurrency,
    paymentUsdRate,
    invoiceCurrency: invoice.currency,
    invoiceUsdRateOnPaymentDate: invoice.currency === "USD" ? "1" : invoice.usdRate,
  }).amountInvoiceCurrency;
}

/**
 * The invoice-currency amount the row's field shows: what the user typed, else the proposal, else nothing. A proposal
 * reaches a request only as this visible, editable value (rule 22, HU-13 CA4).
 */
export function shownInvoiceAmount(
  row: AppliedRow | undefined,
  invoice: OpenInvoiceOption,
  paymentCurrency: string,
  paymentUsdRate: string,
): string {
  if (row?.invoiceAmount !== undefined) return row.invoiceAmount;
  if (!row?.amountPayment) return "";
  return proposeInvoiceAmount(row.amountPayment, paymentCurrency, paymentUsdRate, invoice) ?? "";
}

export const isPositiveAmount = (value: string): boolean =>
  isDecimalString(value) && compareMoney(value, "0") > 0;

type AllocationRowsProps = {
  openInvoices: OpenInvoiceOption[];
  applied: Record<string, AppliedRow>;
  /** Currency of the payment the amounts are applied from. */
  currency: string;
  usdRate: string;
  onRowChange: (invoiceId: string, patch: Partial<AppliedRow>) => void;
  /** Message key per invoice id, shown on the row (a BE refusal at its path, or a missing amount). */
  errors?: Record<string, string>;
  /** Keeps the field ids unique when two lists can be on screen. */
  idPrefix?: string;
};

/**
 * "Aplicar a facturas" rows (HU-13 CA1, CA4), shared by the payment form and the allocation sheet (rule 22): the
 * payment-currency amount typed, the invoice-currency amount proposed from the payment-date rate and editable. Row
 * state changes are transitions, not keyframes.
 */
export function AllocationRows({
  openInvoices,
  applied,
  currency,
  usdRate,
  onRowChange,
  errors = {},
  idPrefix = "payment-alloc",
}: AllocationRowsProps) {
  const t = useTranslations("payments.form");
  const tRoot = useTranslations();

  return (
    <div className="flex flex-col gap-3">
      {openInvoices.map((invoice) => {
        const row = applied[invoice.id];
        const selected = row?.selected ?? false;
        const error = errors[invoice.id];
        return (
          <div
            key={invoice.id}
            data-slot="allocation-row"
            data-selected={selected}
            className="grid items-center gap-3 rounded-xl border p-3 text-sm transition-colors duration-150 data-[selected=true]:border-primary/40 data-[selected=true]:bg-muted/40 @lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <label className="flex items-center gap-3">
              <Checkbox
                checked={selected}
                onCheckedChange={(value) => onRowChange(invoice.id, { selected: value === true })}
                aria-label={invoice.code}
              />
              <span className="flex flex-col">
                <span className="font-medium">{invoice.code}</span>
                <span className="text-xs text-muted-foreground">{invoice.invoiceNumber}</span>
              </span>
            </label>
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">{t("fields.balanceHeader")}</span>
              <MoneyText amount={invoice.balance} currency={invoice.currency} />
            </div>
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-${invoice.id}`}>
                {t("fields.amountHeader", { currency })}
              </FieldLabel>
              <Input
                id={`${idPrefix}-${invoice.id}`}
                inputMode="decimal"
                className="tabular-nums"
                disabled={!selected}
                value={row?.amountPayment ?? ""}
                aria-invalid={error ? true : undefined}
                onChange={(event) =>
                  onRowChange(invoice.id, {
                    amountPayment: event.target.value,
                    invoiceAmount: undefined,
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-inv-${invoice.id}`}>
                {t("fields.invoiceCurrencyHeader", { currency: invoice.currency })}
              </FieldLabel>
              <Input
                id={`${idPrefix}-inv-${invoice.id}`}
                inputMode="decimal"
                className="tabular-nums"
                disabled={!selected}
                value={shownInvoiceAmount(row, invoice, currency, usdRate)}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onRowChange(invoice.id, { invoiceAmount: event.target.value })}
              />
              <FieldDescription>{t("fields.proposedHint")}</FieldDescription>
            </Field>
            {error ? (
              <p role="alert" className="text-xs text-destructive @lg:col-span-full">
                {tRoot(error as never)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
