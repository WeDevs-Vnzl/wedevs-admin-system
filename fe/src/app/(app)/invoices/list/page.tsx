import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { preferenceToColumnConfig } from "@/components/ui/data-table/column-config";
import { listCurrencies } from "@/features/catalogs/queries";
import { invoiceFilterOf } from "@/features/invoices/components/invoice-table-query";
import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { invoiceScreenPermissions } from "@/features/invoices/permissions";
import { listInvoices } from "@/features/invoices/queries";
import { getPreferences } from "@/features/preferences/queries";
import { requireSessionUser } from "@/server/auth/session";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type InvoicesListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices.page");
  return { title: t("listTitle") };
}

// `/invoices/list` (PRD §8.5, DT-25): the table of invoices, with facets, search, sort and pagination in the URL.
// Archived invoices stay out unless "Mostrar archivados" is on. Owner and Admin only.
export default async function InvoicesListPage({ searchParams }: InvoicesListPageProps) {
  const user = await requireSessionUser();
  const permissions = invoiceScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, currencies, preferences, t] = await Promise.all([
    listInvoices(invoiceFilterOf(query)),
    listCurrencies(),
    getPreferences(),
    getTranslations("invoices.page"),
  ]);
  const initialColumns = preferenceToColumnConfig(preferences.tableColumns.invoices);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("listTitle")}
        description={t("listDescription")}
        count={page.total}
        views={
          <OverviewTableToggle
            current="table"
            overviewHref="/invoices"
            tableHref="/invoices/list"
          />
        }
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/invoices/new">
                <Plus aria-hidden />
                {t("newAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <InvoicesTable
        initialRows={page.items}
        initialTotal={page.total}
        initialColumns={initialColumns}
        currencies={currencies.map((currency) => currency.code)}
        permissions={{ canCreate: permissions.canCreate, canUpdate: permissions.canUpdate }}
      />
    </div>
  );
}
