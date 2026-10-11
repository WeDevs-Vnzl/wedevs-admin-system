import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { PageHeader } from "@/components/patterns/page-header";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { Button } from "@/components/ui/button";
import {
  tableUrlParsers,
  urlStateToListQuery,
  type ColumnConfig,
} from "@/components/ui/data-table";
import { preferenceToColumnConfig } from "@/components/ui/data-table/column-config";
import { ClientsTable } from "@/features/clients/components/clients-table";
import { clientFilterOf } from "@/features/clients/components/client-table-query";
import { clientScreenPermissions } from "@/features/clients/components/client-permissions";
import { listClients } from "@/features/clients/queries";
import { getPreferences } from "@/features/preferences/queries";
import { requireSessionUser } from "@/server/auth/session";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type ClientsListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("clients.page");
  return { title: t("listTitle") };
}

// `/clients/list` (PRD §7.3, §8.2 "Tabla"). Every role reads the table; "Mostrar archivados" is Owner and Admin
// only, and the service ignores `archived` for anyone else (C19).
export default async function ClientsListPage({ searchParams }: ClientsListPageProps) {
  const user = await requireSessionUser();
  const permissions = clientScreenPermissions(user);
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, preferences, t] = await Promise.all([
    listClients(clientFilterOf(query)),
    getPreferences(),
    getTranslations("clients"),
  ]);
  const initialColumns: ColumnConfig[] = preferenceToColumnConfig(preferences.tableColumns.clients);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        count={page.total}
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/clients/new">
                <Plus aria-hidden />
                {t("page.newAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <OverviewTableToggle current="table" overviewHref="/clients" tableHref="/clients/list" />
      <ClientsTable
        initialRows={page.items}
        initialTotal={page.total}
        initialColumns={initialColumns}
        permissions={permissions}
      />
    </div>
  );
}
