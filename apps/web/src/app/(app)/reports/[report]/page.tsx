import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { ReportDetail } from "@/features/reports/components/report-detail";
import { getKpiDetail, getReportDetail } from "@/features/reports/queries";
import {
  filterFromSearchParams,
  parseReportSlug,
  reportPageTitleKey,
} from "@/features/reports/report-catalog";
import type { ReactNode } from "react";
import type { ActionError } from "@/lib/validators/common";

type ReportPageProps = {
  params: Promise<{ report: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: ReportPageProps): Promise<Metadata> {
  const page = parseReportSlug((await params).report);
  if (!page) return {};
  const t = await getTranslations("reports");
  return { title: t(reportPageTitleKey(page)) };
}

/** The forbidden state for `FORBIDDEN` (Member and Viewer, the BE decides); any other error fails the page. */
async function unavailable(error: ActionError, header: ReactNode) {
  if (error.code !== "FORBIDDEN") throw new Error(error.code);
  const tErrors = await getTranslations("reports.errors");
  return (
    <div className="flex flex-col gap-6">
      {header}
      <EmptyState title={tErrors("forbidden")} />
    </div>
  );
}

// `/reports/[report]` (PRD §8.13.1, §8.13.2): one financial report or one KPI, named by its slug. An unknown slug is
// the in-shell not-found page (C13); Member and Viewer get the forbidden state from the BE's `FORBIDDEN` error.
export default async function ReportPage({ params, searchParams }: ReportPageProps) {
  const page = parseReportSlug((await params).report);
  if (!page) notFound();
  const filter = filterFromSearchParams(await searchParams);
  const t = await getTranslations("reports");
  const header = (
    <PageHeader
      title={t(reportPageTitleKey(page))}
      description={t(`items.${page.kind === "report" ? "reports" : "kpis"}.${page.id}.description`)}
    />
  );

  if (page.kind === "report") {
    const result = await getReportDetail(page.id, filter);
    if (!result.ok) return unavailable(result.error, header);
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ReportDetail
          page={{ kind: "report", id: page.id }}
          initial={result.data}
          initialFilter={filter}
        />
      </div>
    );
  }

  const result = await getKpiDetail(page.id, filter);
  if (!result.ok) return unavailable(result.error, header);
  return (
    <div className="flex flex-col gap-6">
      {header}
      <ReportDetail
        page={{ kind: "kpi", id: page.id }}
        initial={result.data}
        initialFilter={filter}
      />
    </div>
  );
}
