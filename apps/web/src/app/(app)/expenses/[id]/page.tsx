import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { getExpense } from "@/features/expenses/queries";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { todayInCaracas } from "@/lib/dates";
import type { ExpenseDetailDTO } from "@/lib/validators/expenses";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";

type ExpenseDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function readExpense(id: string): Promise<ExpenseDetailDTO | null> {
  try {
    return await getExpense(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: ExpenseDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("expenses.page");
  const expense = await readExpense(id);
  return { title: expense ? expense.description : t("title") };
}

// `/expenses/[id]` (HU-17): the expense, its amounts and, while pending, "Marcar como pagado" (CA2). Unknown ids and
// roles without the expense grant get the not-found page.
export default async function ExpenseDetailPage({ params }: ExpenseDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const expense = await readExpense(id);
  if (!expense) notFound();
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
