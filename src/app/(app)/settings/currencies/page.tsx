import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { CurrenciesTable } from "@/features/catalogs/components/currencies-table";
import { listCurrencies } from "@/features/catalogs/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata() {
  const t = await getTranslations("catalogs.currencies");
  return { title: t("page.title") };
}

// Settings → Monedas (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function CurrenciesPage() {
  const section = await getOpenableSettingsSection("currencies");
  if (!section) notFound();

  const t = await getTranslations("catalogs.currencies");
  const rows = await listCurrencies({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={rows.length} />
      <CurrenciesTable rows={rows} />
    </div>
  );
}
