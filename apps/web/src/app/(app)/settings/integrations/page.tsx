import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { IntegrationsForm } from "@/features/integrations/components/integrations-form";
import { getIntegrationsScreen } from "@/features/integrations/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.integrations");
  return { title: t("title") };
}

// Settings → Integraciones (DT-183, DT-184): Owner and Admin (the `settings` grant). Other roles get the in-shell
// not-found page; the BE decides on every read and save.
export default async function IntegrationsSettingsPage() {
  if (!(await getOpenableSettingsSection("integrations"))) notFound();

  const screen = await getIntegrationsScreen(await getLocale());
  return (
    <IntegrationsForm
      initial={screen.mapping}
      accounts={screen.accounts}
      walletAccounts={screen.walletAccounts}
      methods={screen.methods}
    />
  );
}
