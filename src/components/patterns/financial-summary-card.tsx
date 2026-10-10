"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FinancialSummaryRow = {
  label: string;
  value: ReactNode;
  // Overdue or negative figures use the danger tone.
  danger?: boolean;
};

type FinancialSummaryCardProps = {
  title?: string;
  rows: FinancialSummaryRow[];
  // Bottom line (e.g. receivable balance), emphasised.
  total?: FinancialSummaryRow;
};

// Dark "Estado financiero" card of the detail side panel (wireframe 4.5).
export function FinancialSummaryCard({ title, rows, total }: FinancialSummaryCardProps) {
  const t = useTranslations("patterns.financialSummary");

  return (
    <Card className="rounded-2xl border-transparent bg-zinc-900 text-zinc-50 dark:bg-zinc-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-zinc-300">{title ?? t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="text-zinc-400">{row.label}</span>
            <span className={cn("tabular-nums", row.danger && "text-red-400")}>{row.value}</span>
          </div>
        ))}
        {total ? (
          <div className="flex items-center justify-between gap-4 border-t border-zinc-700 pt-3">
            <span className="font-medium">{total.label}</span>
            <span
              className={cn("text-lg font-semibold tabular-nums", total.danger && "text-red-400")}
            >
              {total.value}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
