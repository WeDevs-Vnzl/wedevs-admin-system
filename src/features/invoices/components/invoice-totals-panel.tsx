"use client";

import { useTranslations } from "next-intl";
import { MoneyText } from "@/components/patterns/money-text";
import type { InvoiceTotals } from "@/lib/finance";

type InvoiceTotalsPanelProps = {
  /** Output of `computeInvoiceTotals` (C17): the panel only displays it. */
  totals: InvoiceTotals;
  currency: string;
};

/**
 * Header totals of an invoice (DT-44, HU-11 CA2): the base and IVA of every VAT rate, the exempt amount, the total,
 * the withholdings, the receivable, and the USD snapshots. No formula lives here: every figure comes from `lib/finance`.
 */
export function InvoiceTotalsPanel({ totals, currency }: InvoiceTotalsPanelProps) {
  const t = useTranslations("invoices.totals");

  const rows: { key: string; label: string; amount: string }[] = [
    { key: "subtotal", label: t("subtotal"), amount: totals.subtotal },
    { key: "discount", label: t("discount"), amount: totals.discount },
    { key: "exempt", label: t("exempt"), amount: totals.exemptAmount },
    { key: "taxBase", label: t("taxBase"), amount: totals.taxBase },
    { key: "iva", label: t("iva"), amount: totals.ivaAmount },
    { key: "total", label: t("total"), amount: totals.total },
    { key: "withholdings", label: t("withholdings"), amount: totals.withholdings },
    { key: "receivable", label: t("receivable"), amount: totals.receivable },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="invoice-totals">
      {totals.taxLines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">{t("rateColumn")}</th>
                <th className="py-1 text-right font-medium">{t("baseColumn")}</th>
                <th className="py-1 text-right font-medium">{t("ivaColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {totals.taxLines.map((line) => (
                <tr key={line.ivaRate} className="border-t">
                  <td className="py-1">{t("rate", { rate: line.ivaRate })}</td>
                  <td className="py-1 text-right">
                    <MoneyText amount={line.taxBase} currency={currency} />
                  </td>
                  <td className="py-1 text-right">
                    <MoneyText amount={line.ivaAmount} currency={currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <dl className="grid gap-2 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>
              <MoneyText amount={row.amount} currency={currency} />
            </dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 border-t pt-2">
          <dt className="text-muted-foreground">{t("totalUsd")}</dt>
          <dd>
            <MoneyText amount={totals.totalUsd} currency="USD" />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{t("receivableUsd")}</dt>
          <dd>
            <MoneyText amount={totals.receivableUsd} currency="USD" />
          </dd>
        </div>
      </dl>
    </div>
  );
}
