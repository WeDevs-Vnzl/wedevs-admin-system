import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { RatesTable } from "@/features/catalogs/components/rates-table";
import {
  exchangeRateFilterFromParams,
  getQuickLoadContext,
  listExchangeRates,
} from "@/features/catalogs/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata() {
  const t = await getTranslations("catalogs.rates");
  return { title: t("page.title") };
}

type RatesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Settings → Tasas (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function RatesPage({ searchParams }: RatesPageProps) {
  const section = await getOpenableSettingsSection("rates");
  if (!section) notFound();

  const t = await getTranslations("catalogs.rates");
  const [page, quickLoad] = await Promise.all([
    listExchangeRates(exchangeRateFilterFromParams(await searchParams)),
    getQuickLoadContext(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={page.total} />
      <RatesTable
        rows={page.items}
        total={page.total}
        today={quickLoad.today}
        currencies={quickLoad.currencies}
      />
    </div>
  );
}
