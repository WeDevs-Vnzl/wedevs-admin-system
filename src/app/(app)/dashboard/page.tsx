import { getTranslations } from "next-intl/server";

// Placeholder: the dashboard KPIs, alerts and charts are built with the H1-B2 and H1-B5 batches.
export default async function DashboardPage() {
  const t = await getTranslations("shell.dashboardPlaceholder");

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-muted-foreground">{t("description")}</p>
    </section>
  );
}
