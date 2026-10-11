import { listNotes, getNotesViewer } from "@/features/notes/queries";
import { noteLinkEntityTypeSchema } from "@/lib/validators/notes";
import type { EntityRef } from "@/lib/validators/common";
import { NOTES_FEED_PAGE_SIZE, NotesFeed } from "./notes-feed";

/**
 * The shared *Notas* tab of a detail page (PRD §7.2, §8.10): the feed of the notes linked to `entity`, with
 * "+ Nueva nota" pre-linked to it. Server component: it reads through `features/notes/queries`.
 */
export async function EntityNotesTab({ entity }: { entity: EntityRef }) {
  const type = noteLinkEntityTypeSchema.parse(entity.type);
  const [initial, viewer] = await Promise.all([
    listNotes({ entityType: type, entityId: entity.id, pageSize: NOTES_FEED_PAGE_SIZE }),
    getNotesViewer(),
  ]);
  return (
    <NotesFeed
      initial={initial}
      entity={{ id: entity.id, label: entity.label, type }}
      viewer={viewer}
    />
  );
}
