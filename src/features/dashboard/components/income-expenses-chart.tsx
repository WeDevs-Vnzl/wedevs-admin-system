"use client";

import { ChevronDown, Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { MoneyText } from "@/components/patterns/money-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import type { MonthKey, MultiSeries } from "@/lib/validators/dashboard";
import { cn } from "@/lib/utils";
import { downloadCsv, toCsv } from "../csv";
import { DashboardPanel } from "./dashboard-panel";

type IncomeExpensesChartProps = {
  data: MultiSeries;
  /** MRR at the current month's close, shown as a chip beside the title (wireframe 4.2). */
  mrr: string | null;
  month: MonthKey;
};

function monthLabel(period: MonthKey, locale: string): string {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * "Ingresos frente a gastos de los últimos 12 meses (gráfico de barras)" (PRD §8.1) on the registry `chart`, with
 * the collapsible data table and the CSV export every chart carries (frontend-patterns §9).
 */
export function IncomeExpensesChart({ data, mrr, month }: IncomeExpensesChartProps) {
  const t = useTranslations("dashboard.chart");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const values = (id: string) =>
    data.series.find((series) => series.id === id)?.values ?? data.periods.map(() => "0.00");
  const income = values("income");
  const expenses = values("expenses");
  // Recharts plots numbers; the figures themselves stay decimal strings in the table and the CSV (C15).
  const points = data.periods.map((period, index) => ({
    period,
    label: monthLabel(period, locale),
    income: Number(income[index]),
    expenses: Number(expenses[index]),
  }));
  const config = {
    income: { label: t("income"), color: "var(--chart-1)" },
    expenses: { label: t("expenses"), color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const exportCsv = () =>
    downloadCsv(
      t("filename", { month }),
      toCsv(
        [t("month"), t("income"), t("expenses")],
        data.periods.map((period, index) => [period, income[index] ?? "", expenses[index] ?? ""]),
      ),
    );

  return (
    <DashboardPanel
      title={t("title")}
      actions={
        mrr !== null ? (
          <Badge variant="secondary" className="tabular-nums">
            {t("mrr", { amount: formatMoney(mrr, "USD", locale) })}
          </Badge>
        ) : null
      }
    >
      <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-4">
        <ChartContainer config={config} className="aspect-auto h-64 w-full">
          <BarChart data={points} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={48} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="income" fill="var(--color-income)" radius={4} />
            <Bar dataKey="expenses" fill="var(--color-expenses)" radius={4} />
          </BarChart>
        </ChartContainer>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {open ? t("hideData") : t("showData")}
              <ChevronDown
                aria-hidden
                className={cn("transition-[rotate] duration-150", open && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download aria-hidden />
            {t("exportCsv")}
          </Button>
        </div>
        <CollapsibleContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("month")}</TableHead>
                <TableHead className="text-end">{t("income")}</TableHead>
                <TableHead className="text-end">{t("expenses")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.periods.map((period, index) => (
                <TableRow key={period}>
                  <TableCell className="tabular-nums">{period}</TableCell>
                  <TableCell className="text-end">
                    <MoneyText amount={income[index] ?? "0.00"} currency="USD" />
                  </TableCell>
                  <TableCell className="text-end">
                    <MoneyText amount={expenses[index] ?? "0.00"} currency="USD" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleContent>
      </Collapsible>
    </DashboardPanel>
  );
}
