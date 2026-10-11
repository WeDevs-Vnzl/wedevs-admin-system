import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { getClient } from "@/features/clients/queries";
import { listDocuments } from "@/features/documents/queries";
import { NoteComposerPage } from "@/features/notes/components/note-composer";
import type { NoteLinkRef } from "@/features/notes/components/note-link-picker";
import { getNotesViewer } from "@/features/notes/queries";
import { getProject } from "@/features/projects/queries";
import { canCreateTagsInline } from "@/features/tags/queries";
import { ServiceError } from "@/server/context";
import { can } from "@/server/auth/permissions";

type NewNotePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notes.composer");
  return { title: t("createTitle") };
}

/**
 * The record a new note is prefilled with (`?entityType=&entityId=`), labelled the way the search actions label
 * it. A record that cannot be read (missing, archived, not visible) leaves the note unlinked. Contacts have no
 * read query of their own yet, so they are not prefilled.
 */
async function prefillLink(type: string | undefined, id: string | undefined): Promise<NoteLinkRef[]> {
  if (!type || !id) return [];
  try {
    if (type === "CLIENT") {
      const client = await getClient(id);
      return [{ type: "CLIENT", id, label: client.tradeName }];
    }
    if (type === "PROJECT") {
      const project = await getProject(id);
      return [{ type: "PROJECT", id, label: project.name }];
    }
    if (type === "DOCUMENT") {
      const page = await listDocuments({ pageSize: 100 });
      const document = page.items.find((row) => row.id === id);
      return document ? [{ type: "DOCUMENT", id, label: document.title }] : [];
    }
    return [];
  } catch (error) {
    if (error instanceof ServiceError) return [];
    throw error;
  }
}

// `/notes/new` (PRD §8.10): the composer as a full page. Viewers cannot create notes: they get the not-found page.
export default async function NewNotePage({ searchParams }: NewNotePageProps) {
  const viewer = await getNotesViewer();
  if (!can(viewer, "create", "note")) notFound();

  const params = await searchParams;
  const entityType = typeof params.entityType === "string" ? params.entityType : undefined;
  const entityId = typeof params.entityId === "string" ? params.entityId : undefined;
  const [initialLinks, canCreateTags, t] = await Promise.all([
    prefillLink(entityType, entityId),
    canCreateTagsInline(),
    getTranslations("notes.composer"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("createTitle")} description={t("description")} />
      <NoteComposerPage initialLinks={initialLinks} canCreateTags={canCreateTags} />
    </div>
  );
}
