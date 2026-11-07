import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
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

// `/reports` (PRD §8.13, §11): KPI cards and the index of the financial reports. The BE decides who reads them
// (Owner and Admin); anyone else gets the forbidden state, not the data.
export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const filter = filterFromSearchParams(await searchParams);
  const result = await getKpiCards(filter);
  const t = await getTranslations("reports.page");

  if (!result.ok && result.error.code === "FORBIDDEN") {
    const tErrors = await getTranslations("reports.errors");
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("title")} description={t("description")} />
        <EmptyState title={tErrors("forbidden")} />
      </div>
    );
  }
  if (!result.ok) throw new Error(result.error.code);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <ReportsOverview initialKpis={result.data.kpis} initialFilter={filter} />
    </div>
  );
}
