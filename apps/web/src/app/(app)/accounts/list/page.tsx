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
import { accountFilterOf } from "@/features/accounts/components/account-table-query";
import { AccountsTable } from "@/features/accounts/components/accounts-table";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { listAccounts } from "@/features/accounts/queries";
import { listCurrencies } from "@/features/catalogs/queries";
import { requireSessionUser } from "@/server/auth/session";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type AccountsListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts.page");
  return { title: t("listTitle") };
}

// `/accounts/list` (DT-25, S15): every account, inactive ones included so they can be reactivated, with the type,
// currency and status facets, search, header sort and pagination in the URL. Owner and Admin only.
export default async function AccountsListPage({ searchParams }: AccountsListPageProps) {
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, currencies, t] = await Promise.all([
    listAccounts(accountFilterOf(query)),
    listCurrencies({ includeInactive: true }),
    getTranslations("accounts"),
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
            overviewHref="/accounts"
            tableHref="/accounts/list"
          />
        }
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/accounts/new">
                <Plus aria-hidden />
                {t("page.newAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <AccountsTable
        initialRows={page.items}
        initialTotal={page.total}
        currencies={currencies.map((currency) => currency.code)}
      />
    </div>
  );
}
