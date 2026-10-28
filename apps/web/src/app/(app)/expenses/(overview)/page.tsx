import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExpensesOverview } from "@/features/expenses/components/expenses-overview";
import { getExpensesOverview } from "@/features/expenses/queries";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("overviewTitle") };
}

// `/expenses` (PRD §8.8 "Overview", DT-25: the overview is not the list). Owner and Admin only; other roles get the
// not-found page.
export default async function ExpensesOverviewPage() {
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const overview = await getExpensesOverview();

  return <ExpensesOverview overview={overview} permissions={permissions} />;
}
