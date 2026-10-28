import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { ReportsOverview } from "@/features/reports/components/reports-overview";
import { getKpiCards } from "@/features/reports/queries";
import { filterFromSearchParams } from "@/features/reports/report-catalog";

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports.page");
  return { title: t("title") };
}

// `/reports` (PRD §8.13, §11): KPI cards and the index of the financial reports. Owner and Admin only; anyone else
// gets the in-shell not-found page (C13).
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const filter = filterFromSearchParams(await searchParams);
  const kpis = await getKpiCards(filter);
  if (!kpis) notFound();
  const t = await getTranslations("reports.page");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <ReportsOverview initialKpis={kpis} initialFilter={filter} />
    </div>
  );
}
