import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { PageHeader } from "@/components/patterns/page-header";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { getOpenableSettingsSection } from "@/features/settings/queries";
import { TrashTable } from "@/features/trash/components/trash-table";
import { trashFilterOf } from "@/features/trash/components/trash-table-query";
import { getTrash } from "@/features/trash/queries";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type TrashSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("trash");
  return { title: t("page.title") };
}

// Settings → Papelera (PRD §7.7, HU-28): archived records, filtered and restored from here. Owner and Admin
// only; other roles get the in-shell not-found page. No permanent purge in the MVP.
export default async function TrashSettingsPage({ searchParams }: TrashSettingsPageProps) {
  if (!(await getOpenableSettingsSection("trash"))) notFound();

  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, t] = await Promise.all([getTrash(trashFilterOf(query)), getTranslations("trash")]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={page.total} />
      <TrashTable initialRows={page.items} initialTotal={page.total} />
    </div>
  );
}
