"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { KpiCard } from "@/components/patterns/kpi-card";
import { Card } from "@/components/ui/card";
import { toDecimal } from "@/lib/money";
import { REPORT_ID_VALUES, type KpiResultDTO, type ReportFilter } from "@/lib/validators/reports";
import { getKpisAction } from "../actions";
import { reportHref } from "../report-catalog";
import { KpiSparkline } from "./kpi-sparkline";
import { ReportRangeFilter } from "./report-range-filter";
import { useReportFormat } from "./use-report-format";
import { useReportRange } from "./use-report-range";

const loadKpis = (filter: ReportFilter) => getKpisAction({ filter });

export interface ReportsOverviewProps {
  initialKpis: KpiResultDTO[];
  initialFilter: ReportFilter;
}

/** Variation of a KPI card: direction and "+12,5 % frente al periodo anterior". */
export function useKpiVariation() {
  const t = useTranslations("reports");
  const fmt = useReportFormat();
  return (kpi: KpiResultDTO) => {
    if (kpi.changePercent === null) {
      return { label: t("kpi.noPrevious"), direction: "flat" as const };
    }
    const change = toDecimal(kpi.changePercent);
    const sign = change.isPositive() && !change.isZero() ? "+" : "";
    return {
      label: t("kpi.variation", {
        change: `${sign}${t("units.PERCENT", { value: fmt.number(kpi.changePercent) })}`,
      }),
      direction: change.isZero()
        ? ("flat" as const)
        : change.isPositive()
          ? ("up" as const)
          : ("down" as const),
    };
  };
}

/**
 * `/reports` (PRD §8.13, HU-31): the date range, one card per KPI with its value, the change vs the previous period
 * and a 12-month sparkline (each opens its detail), and the index of the ten financial reports.
 */
export function ReportsOverview({ initialKpis, initialFilter }: ReportsOverviewProps) {
  const t = useTranslations("reports");
  const fmt = useReportFormat();
  const variation = useKpiVariation();
  const {
    filter,
    data: kpis,
    pending,
    changeFilter,
  } = useReportRange(initialFilter, initialKpis, loadKpis);

  return (
    <div className="flex flex-col gap-6">
      <ReportRangeFilter value={filter} onChange={changeFilter} />
      <section className="flex flex-col gap-3" aria-busy={pending}>
        <h2 className="text-lg font-semibold">{t("page.kpisTitle")}</h2>
        <ul
          aria-label={t("page.kpisTitle")}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {kpis.map((kpi) => (
            <li key={kpi.id}>
              <KpiCard
                label={t(`items.kpis.${kpi.id}.title`)}
                value={fmt.kpiValue(kpi.unit, kpi.value)}
                variation={variation(kpi)}
                href={reportHref({ kind: "kpi", id: kpi.id }, filter)}
                sparkline={
                  <KpiSparkline
                    points={kpi.sparkline}
                    label={t("kpi.sparkline")}
                    formatValue={(value) => fmt.kpiValue(kpi.unit, value)}
                  />
                }
              />
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("page.reportsTitle")}</h2>
        <ul aria-label={t("page.reportsTitle")} className="grid gap-3 md:grid-cols-2">
          {REPORT_ID_VALUES.map((id) => (
            <li key={id}>
              <Card className="rounded-2xl transition-shadow hover:shadow-md has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50">
                <Link
                  href={reportHref({ kind: "report", id }, filter)}
                  className="flex items-start justify-between gap-3 rounded-2xl px-6 outline-none"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">{t(`items.reports.${id}.title`)}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`items.reports.${id}.description`)}
                    </span>
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
