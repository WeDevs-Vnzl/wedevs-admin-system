import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { getExpense } from "@/features/expenses/queries";
import { notFoundWhenRefused, orNullWhenMissing } from "@/features/expenses/refusal";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

type ExpenseEditPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("editTitle") };
}

// `/expenses/[id]/edit` (Q-FEINT-11 (A), DT-213): the create form over `PATCH /expenses/{id}`. Roles that may not
// update expenses and unknown ids get the not-found page; whether the expense is still pending is the BE's rule
// (a paid one answers the mapped `CONFLICT` `expenses.errors.notPending` when saved).
export default async function ExpenseEditPage({ params }: ExpenseEditPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canUpdate) notFound();
  const expense = await notFoundWhenRefused(
    async () => (await orNullWhenMissing(() => getExpense(id))) ?? notFound(),
  );
  const options = await getExpenseFormOptions();

  return (
    <>
      <BreadcrumbLabel segment={expense.id} label={expense.code} />
      <ExpenseForm options={options} today={todayInCaracas(new Date())} expense={expense} />
    </>
  );
}
