"use client";

import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { Button } from "@/components/ui/button";
import { AlertList } from "@/features/alerts/components/alert-list";
import type { DashboardResponseDto } from "@/lib/api/types/intel";
import { formatDate } from "@/lib/dates";
import { downloadCsv, toCsv } from "../csv";
import type { DashboardPeriod } from "../period";
import {
  DocumentsExpiringPanel,
  InstallmentsPanel,
  InvoicesDuePanel,
  RecentActivityPanel,
  RecurringExpensesPanel,
} from "./dashboard-panels";
import { DashboardPanel } from "./dashboard-panel";
import { IncomeExpensesChart } from "./income-expenses-chart";
import { KpiGrid, visibleKpis } from "./kpi-grid";
import { PeriodSelector } from "./period-selector";

export type DayPart = "morning" | "afternoon" | "evening";

export type DashboardViewProps = {
  /** The BE's dashboard of `period`: the eight cards, the chart, the panels and the period bounds. */
  dashboard: DashboardResponseDto;
  period: DashboardPeriod;
  /** `canSeeFinancials`: Member and Viewer get the version without financial data (PRD §11). */
  showFinancials: boolean;
  userName: string;
  dayPart: DayPart;
  today: string;
};

/**
 * `/dashboard` (PRD §8.1, wireframe 4.2): greeting and date, period selector and export, the KPI cards, the
 * 12-month income vs expenses chart, the panels of §8.1 and the shared alerts list (§7.9).
 */
export function DashboardView({
  dashboard,
  period,
  showFinancials,
  userName,
  dayPart,
  today,
}: DashboardViewProps) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const mrr = dashboard.kpis.find((card) => card.id === "MRR")?.value ?? null;

  const exportKpis = () =>
    downloadCsv(
      t("page.exportFilename", { period: `${period}-${dashboard.periodStart}` }),
      toCsv(
        [t("kpis.csvCard"), t("kpis.csvValue"), t("kpis.csvPrevious"), t("kpis.csvChange")],
        visibleKpis(dashboard.kpis, showFinancials).map((card) => [
          t(`kpis.${card.id}`, { period }),
          card.value,
          card.previousValue ?? "",
          card.changePercent ?? "",
        ]),
      ),
    );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("page.greeting", { part: dayPart, name: userName })}
          </h1>
          <p className="text-sm text-muted-foreground">
            <DateText value={today} style="long" /> · {t("page.summary")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("page.periodRange", {
              from: formatDate(dashboard.periodStart, locale),
              to: formatDate(dashboard.periodEnd, locale),
            })}
          </p>
          {showFinancials ? (
            <p className="text-xs text-muted-foreground">{t("page.currencyNote")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector period={period} />
          <Button variant="outline" onClick={exportKpis}>
            <Download aria-hidden />
            {t("page.export")}
          </Button>
        </div>
      </header>

      <KpiGrid kpis={dashboard.kpis} period={period} showFinancials={showFinancials} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-6">
          {showFinancials ? (
            <>
              <IncomeExpensesChart
                data={dashboard.incomeVsExpenses}
                mrr={mrr}
                month={dashboard.month}
              />
              <InvoicesDuePanel rows={dashboard.invoicesDue} />
              <div className="grid gap-6 md:grid-cols-2">
                <InstallmentsPanel rows={dashboard.installmentsToInvoice} />
                <RecurringExpensesPanel rows={dashboard.upcomingRecurringExpenses} />
              </div>
            </>
          ) : null}
          <DocumentsExpiringPanel rows={dashboard.documentsExpiring} />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <DashboardPanel title={t("alerts.title")}>
            <AlertList variant="full" limit={5} />
          </DashboardPanel>
          <RecentActivityPanel rows={dashboard.recentActivity} />
        </div>
      </div>
    </div>
  );
}
