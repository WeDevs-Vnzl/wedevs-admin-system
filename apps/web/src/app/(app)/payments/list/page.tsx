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
import { listAccounts } from "@/features/accounts/queries";
import { listCurrencies, listPaymentMethods } from "@/features/catalogs/queries";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import { paymentFilterOf } from "@/features/payments/components/payment-table-query";
import { paymentScreenPermissions } from "@/features/payments/permissions";
import { listPayments } from "@/features/payments/queries";
import { requireSessionUser } from "@/server/auth/session";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type PaymentsListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.page");
  return { title: t("listTitle") };
}

// `/payments/list` (DT-25): every payment in the server table, with facets, search, header sort, pagination and
// the query in the URL. Roles without the payment read grant get the not-found page.
export default async function PaymentsListPage({ searchParams }: PaymentsListPageProps) {
  const user = await requireSessionUser();
  const permissions = paymentScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, accounts, methods, currencies, t] = await Promise.all([
    listPayments(paymentFilterOf(query)),
    listAccounts({ pageSize: 100 }),
    listPaymentMethods({ includeInactive: true }),
    listCurrencies({ includeInactive: true }),
    getTranslations("payments"),
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
            overviewHref="/payments"
            tableHref="/payments/list"
          />
        }
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/payments/new">
                <Plus aria-hidden />
                {t("page.newAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PaymentsTable
        initialRows={page.items}
        initialTotal={page.total}
        canCreate={permissions.canCreate}
        facetSources={{
          accounts: accounts.items.map(({ id, name }) => ({ id, name })),
          methods: methods.map(({ id, name, nameEn }) => ({ id, name, nameEn })),
          currencies: currencies.map(({ code, name }) => ({ code, name })),
        }}
      />
    </div>
  );
}
