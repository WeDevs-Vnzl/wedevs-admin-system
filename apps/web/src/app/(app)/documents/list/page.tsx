import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { preferenceToColumnConfig } from "@/components/ui/data-table/column-config";
import { DocumentsTable } from "@/features/documents/components/documents-table";
import { documentFilterOf } from "@/features/documents/components/documents-table-query";
import {
  getDocumentPermissions,
  listDocumentCategories,
  listDocuments,
} from "@/features/documents/queries";
import { getPreferences } from "@/features/preferences/queries";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type DocumentsListPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("documents.page");
  return { title: t("listTitle") };
}

// `/documents/list` (PRD §8.9.5 "Tabla", DT-25): the table of documents, with facets, search, sort and pagination
// in the URL. Every role reads documents; the create entry points show only to the roles that may create.
export default async function DocumentsListPage({ searchParams }: DocumentsListPageProps) {
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, categories, permissions, preferences, t] = await Promise.all([
    listDocuments(documentFilterOf(query)),
    listDocumentCategories(),
    getDocumentPermissions(),
    getPreferences(),
    getTranslations("documents.page"),
  ]);
  const initialColumns = preferenceToColumnConfig(preferences.tableColumns.documents);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("listTitle")}
        description={t("listDescription")}
        count={page.total}
        views={
          <OverviewTableToggle
            current="table"
            overviewHref="/documents"
            tableHref="/documents/list"
          />
        }
        actions={
          permissions.canCreate ? (
            <Button asChild>
              <Link href="/documents/new">
                <Plus aria-hidden />
                {t("newAction")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <DocumentsTable
        initialRows={page.items}
        initialTotal={page.total}
        initialColumns={initialColumns}
        categories={categories}
        permissions={permissions}
      />
    </div>
  );
}
