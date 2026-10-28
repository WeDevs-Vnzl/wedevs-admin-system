"use client";

import { ChevronDown, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type { ReportSection } from "../report-sections";
import { useReportFormat } from "./use-report-format";

const CHART_COLORS = 5;

/** Starts the browser download of `content` as `filename`. */
function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke on a later tick: Firefox can cancel the download if the URL is gone before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface ReportChartCardProps {
  section: ReportSection;
  /** File name of the CSV, without extension. */
  csvName: string;
}

/**
 * One report chart (registry `chart`) with its collapsible data table and CSV export (PRD §8.13). The figures are
 * also read out as a list, one item per category, starting with the raw category (the month key or the name).
 */
export function ReportChartCard({ section, csvName }: ReportChartCardProps) {
  const t = useTranslations("reports");
  const fmt = useReportFormat();
  const [open, setOpen] = useState(false);
  const title = t(section.titleKey);
  const columnOf = (key: string) => section.columns.find((column) => column.key === key)!;
  const category = columnOf(section.category);

  const config = Object.fromEntries(
    section.series.map((key, index) => [
      key,
      { label: fmt.header(columnOf(key)), color: `var(--chart-${(index % CHART_COLORS) + 1})` },
    ]),
  ) satisfies ChartConfig;
  const data = section.rows.map((row) => ({
    category: fmt.cell(category.kind, row[section.category] ?? null),
    ...Object.fromEntries(section.series.map((key) => [key, Number(row[key] ?? 0)])),
  }));

  const exportCsv = () =>
    downloadCsv(
      `${csvName}.csv`,
      toCsv(
        section.rows,
        section.columns.map((column) => ({
          key: column.key,
          header: fmt.header(column),
          type: column.kind === "money" ? ("money" as const) : ("text" as const),
        })),
      ),
    );

  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="category" tickLine={false} axisLine={false} minTickGap={8} />
      <YAxis tickLine={false} axisLine={false} width={56} />
      <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
      {section.series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
    </>
  );

  return (
    <Card className="rounded-2xl">
      <figure aria-label={title} className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>
            <figcaption>{title}</figcaption>
          </CardTitle>
          <CardAction>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download aria-hidden />
              {t("chart.exportCsv")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {section.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("chart.empty")}</p>
          ) : (
            <ChartContainer config={config} className="aspect-auto h-72 w-full">
              {section.chart === "line" ? (
                <LineChart data={data} accessibilityLayer>
                  {axes}
                  {section.series.map((key) => (
                    <Line
                      key={key}
                      dataKey={key}
                      stroke={`var(--color-${key})`}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={data} accessibilityLayer>
                  {axes}
                  {section.series.map((key) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      fill={`var(--color-${key})`}
                      radius={section.chart === "stacked" ? 0 : 4}
                      stackId={section.chart === "stacked" ? "stack" : undefined}
                    />
                  ))}
                </BarChart>
              )}
            </ChartContainer>
          )}
          <ul className="sr-only">
            {section.rows.map((row, index) => (
              <li key={index}>
                {row[section.category]}:{" "}
                {section.series
                  .map(
                    (key) =>
                      `${fmt.header(columnOf(key))} ${fmt.cell(columnOf(key).kind, row[key] ?? null)}`,
                  )
                  .join(", ")}
              </li>
            ))}
          </ul>
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="self-start">
                <ChevronDown
                  aria-hidden
                  className={cn("transition-transform", open && "rotate-180")}
                />
                {open ? t("chart.hideData") : t("chart.showData")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {section.columns.map((column) => (
                      <TableHead
                        key={column.key}
                        className={
                          column.kind === "text" || column.kind === "key" || column.kind === "month"
                            ? undefined
                            : "text-right"
                        }
                      >
                        {fmt.header(column)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.rows.map((row, index) => (
                    <TableRow key={index}>
                      {section.columns.map((column) => (
                        <TableCell
                          key={column.key}
                          className={cn(
                            "whitespace-nowrap",
                            column.kind === "text" ||
                              column.kind === "key" ||
                              column.kind === "month"
                              ? undefined
                              : "text-right tabular-nums",
                          )}
                        >
                          {fmt.cell(column.kind, row[column.key] ?? null)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </figure>
    </Card>
  );
}
