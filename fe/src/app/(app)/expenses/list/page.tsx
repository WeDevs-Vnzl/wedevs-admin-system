import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { PageHeader } from "@/components/patterns/page-header";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { Button } from "@/components/ui/button";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { ExpensesTable } from "@/features/expenses/components/expenses-table";
import { expenseFilterOf } from "@/features/expenses/components/expense-table-query";
import { getExpenseFormOptions } from "@/features/expenses/form-options";
import { listExpenses } from "@/features/expenses/queries";
import { expenseScreenPermissions } from "@/features/expenses/permissions";
import { requireSessionUser } from "@/server/auth/session";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type ExpensesListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("expenses.page");
  return { title: t("listTitle") };
}

// `/expenses/list` (DT-25): every expense, voided ones included so they stay visible, with facets, search, header
// sort and pagination in the URL. The overview at `/expenses` is the summary view.
export default async function ExpensesListPage({ searchParams }: ExpensesListPageProps) {
  const user = await requireSessionUser();
  const permissions = expenseScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, options, t] = await Promise.all([
    listExpenses(expenseFilterOf(query)),
    getExpenseFormOptions(),
    getTranslations("expenses"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("page.listTitle")}
        description={t("page.description")}
        count={page.total}
        views={
          <OverviewTableToggle
            current="table"
            overviewHref="/expenses"
            tableHref="/expenses/list"
          />
        }
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/expenses/new">
                <Plus aria-hidden />
                {t("page.newAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <ExpensesTable
        initialRows={page.items}
        initialTotal={page.total}
        facetOptions={{
          categories: options.categories,
          accounts: options.accounts,
          projects: options.projects,
        }}
      />
    </div>
  );
}
