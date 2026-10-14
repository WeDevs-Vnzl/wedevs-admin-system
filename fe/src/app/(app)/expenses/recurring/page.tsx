import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { RecurringExpensesTable } from "@/features/expenses/components/recurring-expenses-table";
import { listRecurringExpenses } from "@/features/expenses/queries";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("recurringTitle") };
}

// `/expenses/recurring` (PRD §8.8, HU-17): the schedules, paused and finished ones included. Each active schedule
// generates one pending expense per period through the daily job.
export default async function RecurringExpensesPage() {
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const [page, t] = await Promise.all([
    listRecurringExpenses({ pageSize: 100 }),
    getTranslations("expenses"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("page.recurringTitle")}
        description={t("page.recurringDescription")}
        count={page.total}
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/expenses/recurring/new">
                <Plus aria-hidden />
                {t("page.newRecurringAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <RecurringExpensesTable rows={page.items} />
    </div>
  );
}
