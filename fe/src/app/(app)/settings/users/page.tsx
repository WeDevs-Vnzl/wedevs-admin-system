import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { PageHeader } from "@/components/patterns/page-header";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { getOpenableSettingsSection } from "@/features/settings/queries";
import { UsersTable } from "@/features/users/components/users-table";
import { userFilterOf } from "@/features/users/components/users-table-query";
import { getUsers } from "@/features/users/queries";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type UsersSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.users");
  return { title: t("page.title") };
}

// Settings → Usuarios (PRD §8.15, HU-02 CA1 "Solo el Owner ve la sección `/settings/users`"): every other role
// gets the in-shell not-found page, and the settings nav hides the entry (`read user`, Owner only).
export default async function UsersSettingsPage({ searchParams }: UsersSettingsPageProps) {
  if (!(await getOpenableSettingsSection("users"))) notFound();

  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, t] = await Promise.all([
    getUsers(userFilterOf(query)),
    getTranslations("settings.users"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} count={page.total} />
      <UsersTable initialRows={page.items} initialTotal={page.total} />
    </div>
  );
}
