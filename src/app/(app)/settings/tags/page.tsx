import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createLoader, parseAsInteger, parseAsString } from "nuqs/server";
import { PageHeader } from "@/components/patterns/page-header";
import { TagsTable } from "@/features/tags/components/tags-table";
import { canManageTags, getTags } from "@/features/tags/queries";
import { parseSort } from "@/lib/validators/common";

const PAGE_SIZE_VALUES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

// The table's URL keys (same names as the client table state), read on the server for the first page.
const loadTableState = createLoader({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  sort: parseAsString,
  q: parseAsString,
});

type TagsSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tags");
  return { title: t("page.title") };
}

// Settings → Etiquetas (PRD §8.15): the tag catalogue with usage counts. Owner and Admin only; everyone else
// gets the in-shell not-found page, the same as any section they cannot open.
export default async function TagsSettingsPage({ searchParams }: TagsSettingsPageProps) {
  if (!(await canManageTags())) notFound();

  const state = loadTableState(await searchParams);
  const pageSize = PAGE_SIZE_VALUES.find((size) => size === state.pageSize) ?? DEFAULT_PAGE_SIZE;
  const page = await getTags({
    page: state.page,
    pageSize,
    sort: state.sort && parseSort(state.sort) ? state.sort : undefined,
    q: state.q ?? undefined,
  });
  const t = await getTranslations("tags");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={page.total} />
      <TagsTable initialRows={page.items} initialTotal={page.total} />
    </div>
  );
}
