"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { StatCard } from "@/components/patterns/stat-card";
import { formatDate } from "@/lib/dates";
import type { KpiResultDTO, ReportFilter, ReportResult } from "@/lib/validators/reports";
import { getKpiAction, getReportAction } from "../actions";
import { kpiSections, reportSections } from "../report-sections";
import { ReportChartCard } from "./report-chart-card";
import { ReportRangeFilter } from "./report-range-filter";
import { useKpiVariation } from "./reports-overview";
import { useReportFormat } from "./use-report-format";
import { useReportRange } from "./use-report-range";

export type ReportDetailProps =
  | {
      page: { kind: "report"; id: ReportResult["reportId"] };
      initial: ReportResult;
      initialFilter: ReportFilter;
    }
  | {
      page: { kind: "kpi"; id: KpiResultDTO["id"] };
      initial: KpiResultDTO;
      initialFilter: ReportFilter;
    };

/**
 * `/reports/[report]` (PRD §8.13): the date range and the charts of one report or KPI, each with its data table and
 * CSV. A new range reloads every chart (HU-31 CA2).
 */
export function ReportDetail({ page, initial, initialFilter }: ReportDetailProps) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const fmt = useReportFormat();
  const variation = useKpiVariation();
  const load = useCallback(
    (filter: ReportFilter) =>
      page.kind === "report"
        ? getReportAction({ id: page.id, filter })
        : getKpiAction({ id: page.id, filter }),
    [page.kind, page.id],
  );
  const { filter, data, pending, changeFilter } = useReportRange<ReportResult | KpiResultDTO>(
    initialFilter,
    initial,
    load,
  );

  const isReport = "reportId" in data;
  const sections = isReport ? reportSections(data) : kpiSections(data);
  const slug = page.id.toLowerCase().replaceAll("_", "-");
  const csvName = isReport
    ? `${slug}-${data.range.dateFrom}-${data.range.dateTo}`
    : `${slug}-${filter.preset.toLowerCase()}`;

  return (
    <div className="flex flex-col gap-6" aria-busy={pending}>
      <div className="flex flex-col gap-2">
        <ReportRangeFilter value={filter} onChange={changeFilter} />
        {isReport ? (
          <p className="text-sm text-muted-foreground">
            {t("page.range", {
              from: formatDate(data.range.dateFrom, locale),
              to: formatDate(data.range.dateTo, locale),
            })}
          </p>
        ) : null}
      </div>
      {isReport ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label={t("kpi.value")}
            value={fmt.kpiValue(data.unit, data.value)}
            hint={variation(data).label}
          />
          <StatCard label={t("kpi.previous")} value={fmt.kpiValue(data.unit, data.previousValue)} />
        </div>
      )}
      {sections.map((section) => (
        <ReportChartCard
          key={section.key}
          section={section}
          csvName={`${csvName}-${section.key}`}
        />
      ))}
    </div>
  );
}
