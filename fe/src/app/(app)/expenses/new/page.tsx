import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("newTitle") };
}

// `/expenses/new` (PRD §8.8). Only roles that may create an expense get the form. `?` parameters are not read: a new
// expense starts empty, and the account and the project are picked in the form.
export default async function NewExpensePage() {
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const options = await getExpenseFormOptions();

  return <ExpenseForm options={options} today={todayInCaracas(new Date())} />;
}
