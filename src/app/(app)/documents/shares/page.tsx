import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { PageHeader } from "@/components/patterns/page-header";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { SharesTable } from "@/features/shares/components/shares-table";
import { shareFilterOf } from "@/features/shares/components/shares-table-query";
import { getSharePermissions, listShareLinks } from "@/features/shares/queries";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type SharesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shares.page");
  return { title: t("listTitle") };
}

// `/documents/shares` (PRD §8.11 "La vista `/documents/shares` lista todos los enlaces"). Portal links are Owner/Admin
// only (`share`); other roles get the in-shell 404. Links are created from a document, a client or a project.
export default async function SharesPage({ searchParams }: SharesPageProps) {
  const permissions = await getSharePermissions();
  if (!permissions.canRead) notFound();
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, t] = await Promise.all([
    listShareLinks(shareFilterOf(query)),
    getTranslations("shares.page"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("listTitle")} description={t("listDescription")} count={page.total} />
      <SharesTable initialRows={page.items} initialTotal={page.total} />
    </div>
  );
}
