"use server";

import { entityHref } from "@/lib/entity-routes";
import type { EntityRef } from "@/lib/validators/common";
import {
  archiveNoteInputSchema,
  attachFileInputSchema,
  createNoteInputSchema,
  linkNoteInputSchema,
  noteFilterSchema,
  noteIdInputSchema,
  pinNoteInputSchema,
  unlinkNoteInputSchema,
  updateNoteInputSchema,
  type NoteDetailDTO,
  type NoteFilter,
  type NoteListRowDTO,
} from "@/lib/validators/notes";
import * as notes from "@/mocks/services/notes";
import { defineAction } from "@/server/actions/define-action";
import { defineCsvExportAction } from "@/features/export/define-csv-export-action";
import { exportCsv } from "@/mocks/services/export";
import { NOTE_EXPORT_COLUMNS } from "./columns";

const WRITE = { action: "update", resource: "note" } as const;

/** Pages that show a note: the table, the note and every record it hangs from (their *Notas* tab). */
function notePaths(noteId: string | null, refs: readonly Pick<EntityRef, "type" | "id">[]) {
  const paths = new Set<string>(["/notes"]);
  if (noteId) paths.add(`/notes/${noteId}`);
  for (const ref of refs) {
    const href = entityHref(ref);
    if (href) paths.add(href);
  }
  return [...paths];
}

const refsOf = (targets: readonly { entityType: EntityRef["type"]; entityId: string }[]) =>
  targets.map((target) => ({ type: target.entityType, id: target.entityId }));

export const createNoteAction = defineAction({
  permission: { action: "create", resource: "note" },
  input: createNoteInputSchema,
  revalidate: (data, note: NoteDetailDTO) => notePaths(note.id, refsOf(data.links)),
  handler: (ctx, data) => notes.createNote(ctx, data),
});

export const updateNoteAction = defineAction({
  permission: WRITE,
  input: updateNoteInputSchema,
  revalidate: (_data, note: NoteDetailDTO) => notePaths(note.id, note.links),
  handler: (ctx, data) => notes.updateNote(ctx, data),
});

export const pinNoteAction = defineAction({
  permission: WRITE,
  input: pinNoteInputSchema,
  revalidate: (_data, note: NoteDetailDTO) => notePaths(note.id, note.links),
  handler: (ctx, data) => notes.pinNote(ctx, data),
});

export const linkNoteAction = defineAction({
  permission: WRITE,
  input: linkNoteInputSchema,
  revalidate: (_data, note: NoteDetailDTO) => notePaths(note.id, note.links),
  handler: (ctx, data) => notes.linkNote(ctx, data),
});

export const unlinkNoteAction = defineAction({
  permission: WRITE,
  input: unlinkNoteInputSchema,
  revalidate: (data, note: NoteDetailDTO) =>
    notePaths(note.id, [...note.links, { type: data.target.entityType, id: data.target.entityId }]),
  handler: (ctx, data) => notes.unlinkNote(ctx, data),
});

export const attachFileAction = defineAction({
  permission: WRITE,
  input: attachFileInputSchema,
  revalidate: (_data, note: NoteDetailDTO) => notePaths(note.id, note.links),
  handler: (ctx, data) => notes.attachFile(ctx, data),
});

/**
 * Soft delete. Owner and Admin may archive any note; a Member only their own (PRD §4.3, C13): the grant is
 * own-only, so `ownerOf` resolves the author once the input is parsed.
 */
export const archiveNoteAction = defineAction({
  permission: { action: "delete", resource: "note" },
  input: archiveNoteInputSchema,
  ownerOf: async (ctx, data) => (await notes.getNote(ctx, { id: data.id })).author.id,
  revalidate: () => ["/notes"],
  handler: (ctx, data) => notes.archiveNote(ctx, data),
});

/** Read action behind the card's expanded preview and the composer's edit mode. */
export const getNoteAction = defineAction({
  permission: { action: "read", resource: "note" },
  input: noteIdInputSchema,
  handler: (ctx, data) => notes.getNote(ctx, data),
});

/** Read action behind the feed's "Cargar más" and the table. */
export const listNotesAction = defineAction({
  permission: { action: "read", resource: "note" },
  input: noteFilterSchema,
  handler: (ctx, data) => notes.listNotes(ctx, data),
});

export const exportNotesCsvAction = defineCsvExportAction<NoteListRowDTO, NoteFilter>({
  entity: "NOTE",
  permission: { action: "read", resource: "note" },
  source: {
    entity: "NOTE",
    facets: [
      { id: "authorId", kind: "async" },
      { id: "tagId", kind: "async" },
      { id: "linkedEntityType", kind: "options" },
      { id: "createdAt", kind: "dateRange", fromKey: "createdFrom", toKey: "createdTo" },
    ],
    filterSchema: noteFilterSchema,
    list: notes.listNotes,
    columns: NOTE_EXPORT_COLUMNS,
  },
  exportCsv,
  namespace: "notes",
});
