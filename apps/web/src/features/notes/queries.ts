import "server-only";
import {
  noteFilterSchema,
  noteIdInputSchema,
  type NoteFilterInput,
  type NoteIdInput,
} from "@/lib/validators/notes";
import * as notes from "@/mocks/services/notes";
import { getServiceContext } from "@/server/context";

/** Notes of the table or of one record's feed (`entityType` + `entityId`). */
export async function listNotes(filter: NoteFilterInput = {}) {
  return notes.listNotes(await getServiceContext(), noteFilterSchema.parse(filter));
}

/** One note; `NOT_FOUND` lets the page call `notFound()`. */
export async function getNote(input: NoteIdInput) {
  return notes.getNote(await getServiceContext(), noteIdInputSchema.parse(input));
}

/** The signed-in user's id and role, for the `can()` checks that decide which note actions are shown (cosmetic, C13). */
export async function getNotesViewer() {
  const { user } = await getServiceContext();
  return { id: user.id, role: user.role };
}
