import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createLoader } from "nuqs/server";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { tableUrlParsers, urlStateToListQuery } from "@/components/ui/data-table";
import { getNotesViewer, listNotes } from "@/features/notes/queries";
import { NotesTable } from "@/features/notes/components/notes-table";
import { toNoteFilter } from "@/features/notes/components/note-table-query";
import { canCreateTagsInline } from "@/features/tags/queries";
import { can } from "@/server/auth/permissions";

// The table's URL keys (the same names as the client table state), read on the server for the first page.
const loadTableState = createLoader(tableUrlParsers);

type NotesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notes");
  return { title: t("page.title") };
}

// `/notes` (PRD §8.10): every note the viewer can read, with the global table. Every role reads notes (C13).
export default async function NotesPage({ searchParams }: NotesPageProps) {
  const query = urlStateToListQuery(loadTableState(await searchParams));
  const [page, viewer, canCreateTags, t] = await Promise.all([
    listNotes(toNoteFilter(query)),
    getNotesViewer(),
    canCreateTagsInline(),
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
        canCreateTags={canCreateTags}
      />
    </div>
  );
}
