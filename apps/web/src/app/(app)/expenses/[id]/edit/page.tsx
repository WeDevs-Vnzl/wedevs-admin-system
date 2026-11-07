import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { getExpense } from "@/features/expenses/queries";
import { notFoundWhenRefused, orNullWhenMissing } from "@/features/expenses/refusal";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/lib/auth/session";

type ExpenseEditPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("editTitle") };
}

// `/expenses/[id]/edit` (Q-FEINT-11 (A), DT-213): the create form over `PATCH /expenses/{id}`. Roles that may not
// update expenses and unknown ids get the not-found page; a non-pending expense redirects to its detail (rule 21),
// and the BE's `CONFLICT` `expenses.errors.notPending` stays mapped for the race.
export default async function ExpenseEditPage({ params }: ExpenseEditPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canUpdate) notFound();
  const expense = await notFoundWhenRefused(
    async () => (await orNullWhenMissing(() => getExpense(id))) ?? notFound(),
  );
  // Cosmetic gate (rule 21): the UI offers no edit for a settled or voided expense; the BE refusal stays for the race.
  if (expense.status !== "PENDIENTE") redirect(`/expenses/${expense.id}`);
  const options = await getExpenseFormOptions();

  return (
    <>
      <BreadcrumbLabel segment={expense.id} label={expense.code} />
      <ExpenseForm options={options} today={todayInCaracas(new Date())} expense={expense} />
    </>
  );
}
