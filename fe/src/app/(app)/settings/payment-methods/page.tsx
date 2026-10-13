import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { PaymentMethodsTable } from "@/features/catalogs/components/payment-methods-table";
import { listPaymentMethods } from "@/features/catalogs/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata() {
  const t = await getTranslations("catalogs.paymentMethods");
  return { title: t("page.title") };
}

// Settings → Métodos de pago (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function PaymentMethodsPage() {
  const section = await getOpenableSettingsSection("payment-methods");
  if (!section) notFound();

  const t = await getTranslations("catalogs.paymentMethods");
  const rows = await listPaymentMethods({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={rows.length} />
      <PaymentMethodsTable rows={rows} />
    </div>
  );
}
