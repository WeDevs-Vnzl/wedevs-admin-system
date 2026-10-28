import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { FiscalSettingsForm } from "@/features/catalogs/components/fiscal-settings-form";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { getFiscalSettings, listCurrencies, listPaymentMethods } from "@/features/catalogs/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata() {
  const t = await getTranslations("settings.fiscal");
  return { title: t("title") };
}

// Settings → Fiscal (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function FiscalSettingsPage() {
  const section = await getOpenableSettingsSection("fiscal");
  if (!section) notFound();

  const locale = await getLocale();
  const [fiscal, currencies, methods] = await Promise.all([
    getFiscalSettings(),
    listCurrencies(),
    listPaymentMethods(),
  ]);

  return (
    <FiscalSettingsForm
      initial={fiscal}
      currencies={currencies}
      igtfMethods={methods
        .filter((method) => method.suggestsIgtf)
        .map((method) => catalogLabel(method, locale))}
    />
  );
}
