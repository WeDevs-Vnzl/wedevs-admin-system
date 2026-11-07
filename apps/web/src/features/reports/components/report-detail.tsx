"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { StatCard } from "@/components/patterns/stat-card";
import type { KpiResultDto, ReportResponseDto } from "@/lib/api/types/intel";
import { formatDate } from "@/lib/dates";
import type { KpiId, ReportFilter, ReportId } from "@/lib/validators/reports";
import { getKpiAction, getReportAction } from "../actions";
import { kpiSections, reportSections } from "../report-sections";
import { ReportChartCard } from "./report-chart-card";
import { ReportRangeFilter } from "./report-range-filter";
import { useKpiVariation } from "./reports-overview";
import { useReportFormat } from "./use-report-format";
import { useReportRange } from "./use-report-range";

export type ReportDetailProps =
  | {
      page: { kind: "report"; id: ReportId };
      initial: ReportResponseDto;
      initialFilter: ReportFilter;
    }
  | {
      page: { kind: "kpi"; id: KpiId };
      initial: KpiResultDto;
      initialFilter: ReportFilter;
    };

/**
 * `/reports/[report]` (PRD §8.13): the date range and the charts of one report or KPI, each with its data table and
 * CSV. A new range reloads every chart from the BE (HU-31 CA2).
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
  const { filter, data, pending, changeFilter } = useReportRange<ReportResponseDto | KpiResultDto>(
    initialFilter,
    initial,
    load,
  );

  // A KPI carries its sparkline; a report carries its range. The union of the two narrows on that field.
  if ("sparkline" in data) {
    const kpi = data;
    const sections = kpiSections(kpi);
    const csvName = `${page.id.toLowerCase().replaceAll("_", "-")}-${filter.preset.toLowerCase()}`;
    return (
      <div className="flex flex-col gap-6" aria-busy={pending}>
        <ReportRangeFilter value={filter} onChange={changeFilter} />
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label={t("kpi.value")}
            value={fmt.kpiValue(kpi.unit, kpi.value)}
            hint={variation(kpi).label}
          />
          <StatCard label={t("kpi.previous")} value={fmt.kpiValue(kpi.unit, kpi.previousValue)} />
        </div>
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

  const report = data;
  const sections = reportSections(report);
  const slug = report.reportId.toLowerCase().replaceAll("_", "-");
  const csvName = `${slug}-${report.range.dateFrom}-${report.range.dateTo}`;

  return (
    <div className="flex flex-col gap-6" aria-busy={pending}>
      <div className="flex flex-col gap-2">
        <ReportRangeFilter value={filter} onChange={changeFilter} />
        <p className="text-sm text-muted-foreground">
          {t("page.range", {
            from: formatDate(report.range.dateFrom, locale),
            to: formatDate(report.range.dateTo, locale),
          })}
        </p>
      </div>
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
