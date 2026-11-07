import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { getExpense } from "@/features/expenses/queries";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import {
  notFoundWhenRefused,
  orNullWhenMissing,
  orNullWhenUnavailable,
} from "@/features/expenses/refusal";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

type ExpenseDetailPageProps = {
  params: Promise<{ id: string }>;
};

// An unknown id is `null`; a `FORBIDDEN` from the BE is the same not-found page (C13).
const readExpense = (id: string) => orNullWhenMissing(() => getExpense(id));

export async function generateMetadata({ params }: ExpenseDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("expenses.page");
  const expense = await orNullWhenUnavailable(() => getExpense(id));
  return { title: expense ? expense.description : t("title") };
}

// `/expenses/[id]` (HU-17): the expense, its amounts and, while pending, "Marcar como pagado" (CA2). Unknown ids and
// roles without the expense grant get the not-found page.
export default async function ExpenseDetailPage({ params }: ExpenseDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const expense = await notFoundWhenRefused(async () => (await readExpense(id)) ?? notFound());
  const options = await getExpenseFormOptions();

  return (
    <>
      <BreadcrumbLabel segment={expense.id} label={expense.code} />
      <ExpenseDetail
        expense={expense}
        accounts={options.accounts}
        today={todayInCaracas(new Date())}
        canUpdate={permissions.canUpdate}
      />
    </>
  );
}
