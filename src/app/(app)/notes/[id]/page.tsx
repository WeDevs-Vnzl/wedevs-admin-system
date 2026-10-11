import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { NoteDetail } from "@/features/notes/components/note-detail";
import { getNote, getNotesViewer } from "@/features/notes/queries";
import { noteDisplayTitle } from "@/lib/rich-text";
import { ServiceError } from "@/server/context";
import { can } from "@/server/auth/permissions";

type NotePageProps = {
  params: Promise<{ id: string }>;
};

/** The note, or `null` when it is missing or archived for this viewer (the page then calls `notFound()`). */
async function loadNote(id: string) {
  try {
    return await getNote({ id });
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: NotePageProps): Promise<Metadata> {
  const { id } = await params;
  const [note, t] = await Promise.all([loadNote(id), getTranslations("notes")]);
  if (!note) return { title: t("page.title") };
  return { title: noteDisplayTitle(note.title, note.content) || t("untitled") };
}

// `/notes/[id]` (PRD §8.10): detail and edit. The archive and the update follow the server's `can()` rules; the
// booleans below only decide what the screen shows (C13).
export default async function NoteDetailPage({ params }: NotePageProps) {
  const { id } = await params;
  const note = await loadNote(id);
  if (!note) notFound();

  const [viewer, t] = await Promise.all([getNotesViewer(), getTranslations("notes")]);
  const title = noteDisplayTitle(note.title, note.content) || t("untitled");

  return (
    <>
      <BreadcrumbLabel segment={id} label={title} />
      <NoteDetail
        note={note}
        canUpdate={can(viewer, "update", "note")}
        canArchive={can(viewer, "delete", "note", { ownerId: note.author.id })}
        canCreateTags={can(viewer, "create", "note")}
      />
    </>
  );
}
