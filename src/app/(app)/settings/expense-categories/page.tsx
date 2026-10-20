import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { ExpenseCategoriesTree } from "@/features/catalogs/components/expense-categories-tree";
import { listExpenseCategories } from "@/features/catalogs/queries";
import { getOpenableSettingsSection } from "@/features/settings/queries";

export async function generateMetadata() {
  const t = await getTranslations("catalogs.expenseCategories");
  return { title: t("page.title") };
}

// Settings → Categorías de gasto (PRD §8.15): Owner and Admin only. Other roles get the in-shell not-found page.
export default async function ExpenseCategoriesPage() {
  const section = await getOpenableSettingsSection("expense-categories");
  if (!section) notFound();

  const t = await getTranslations("catalogs.expenseCategories");
  const roots = await listExpenseCategories({ includeInactive: true });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <ExpenseCategoriesTree roots={roots} />
    </div>
  );
}
