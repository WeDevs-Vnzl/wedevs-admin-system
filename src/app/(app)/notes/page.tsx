import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createLoader, parseAsInteger, parseAsJson, parseAsString } from "nuqs/server";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { getNotesViewer, listNotes } from "@/features/notes/queries";
import { NotesTable } from "@/features/notes/components/notes-table";
import { noteFilterFromUrlState } from "@/features/notes/components/note-table-query";
import { DEFAULT_PAGE_SIZE, listFiltersSchema } from "@/lib/validators/common";
import { can } from "@/server/auth/permissions";

// The table's URL keys (same names as the client table state), read on the server for the first page.
const loadNotesState = createLoader({
  page: parseAsInteger.withDefault(1),
  pageSize: parseAsInteger.withDefault(DEFAULT_PAGE_SIZE),
  sort: parseAsString,
  q: parseAsString,
  filters: parseAsJson(listFiltersSchema).withDefault({}),
});

type NotesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notes");
  return { title: t("page.title") };
}

// `/notes` (PRD §8.10): every note the viewer can read, with the global table. Every role reads notes (C13).
export default async function NotesPage({ searchParams }: NotesPageProps) {
  const state = loadNotesState(await searchParams);
  const [page, viewer, t] = await Promise.all([
    listNotes(noteFilterFromUrlState(state)),
    getNotesViewer(),
    getTranslations("notes"),
  ]);
  const canCreate = can(viewer, "create", "note");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        count={page.total}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/notes/new">
                <PlusIcon aria-hidden />
                {t("page.newNote")}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <NotesTable
        initialRows={page.items}
        initialTotal={page.total}
        viewerId={viewer.id}
        canArchiveAll={can(viewer, "delete", "note")}
        canArchiveOwn={can(viewer, "delete", "note", { ownerId: viewer.id })}
        canTag={can(viewer, "update", "note")}
        canCreateTags={canCreate}
      />
    </div>
  );
}
