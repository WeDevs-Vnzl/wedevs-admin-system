import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { ReportDetail } from "@/features/reports/components/report-detail";
import { getReportPageData } from "@/features/reports/queries";
import {
  filterFromSearchParams,
  parseReportSlug,
  reportPageTitleKey,
} from "@/features/reports/report-catalog";

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

// `/reports/[report]` (PRD §8.13.1, §8.13.2): one financial report or one KPI, named by its slug. Owner and Admin
// only; an unknown slug or anyone else gets the in-shell not-found page (C13).
export default async function ReportPage({ params, searchParams }: ReportPageProps) {
  const page = parseReportSlug((await params).report);
  if (!page) notFound();
  const filter = filterFromSearchParams(await searchParams);
  const data = await getReportPageData(page, filter);
  if (!data) notFound();
  const t = await getTranslations("reports");
  const group = page.kind === "report" ? "reports" : "kpis";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(reportPageTitleKey(page))}
        description={t(`items.${group}.${page.id}.description`)}
      />
      {"reportId" in data ? (
        <ReportDetail
          page={{ kind: "report", id: data.reportId }}
          initial={data}
          initialFilter={filter}
        />
      ) : (
        <ReportDetail page={{ kind: "kpi", id: data.id }} initial={data} initialFilter={filter} />
      )}
    </div>
  );
}
