import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RecurringExpenseForm } from "@/features/expenses/components/recurring-expense-form";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("recurringNewTitle") };
}

// `/expenses/recurring/new` (HU-17). Only roles that may create an expense get the form.
export default async function NewRecurringExpensePage() {
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const options = await getExpenseFormOptions();

  return <RecurringExpenseForm options={options} today={todayInCaracas(new Date())} />;
}
