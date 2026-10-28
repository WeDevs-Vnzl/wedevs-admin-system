import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CompanySettingsForm } from "@/features/settings/components/company-settings-form";
import { getCompanySettings, getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.company");
  return { title: t("title") };
}

// Settings → Empresa (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function CompanySettingsPage() {
  if (!(await getOpenableSettingsSection("company"))) notFound();

  const company = await getCompanySettings();
  return <CompanySettingsForm initial={company} />;
}
